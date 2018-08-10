const process = require('process')
const Origin = require('../dist/index') // Will eventualy be the origin npm package
const Web3 = require('web3')

const web3Provider = new Web3.providers.HttpProvider('http://localhost:8545')
const web3 = new Web3(web3Provider)
const o = new Origin({ web3 })

// Origin Listener
// ---------------
// An at-least-once event listener for origin events (May deliver an event more than once).
// Make sure your webhook endpoint is idempotent!
// Sends events along with all the related data.
// Designed to be infura compatible - API calls only, no subscriptions.
//
// To use:
// - Run `npm start run` to setup a local IPFS and blockchain, and run tests
// - In another terminal run `node scripts/listener.js`
//
// Todo
// - Reindex from a certain point
// - POST to Webhooks
// - Keep Stdout option
// - Handle errors
// - Handle blockchain splits/winners
// - Include as-of dates in POST
// - Perhaps send related data as it was on the event, not the latest related

// -----------------------------
// Section 1: Follow rules
// -----------------------------

// Helper functions
const listingId = log => {
  return [log.networkId, log.contractVersionKey, log.decoded.listingID].join(
    '-'
  )
}
const offerId = log => {
  return [
    log.networkId,
    log.contractVersionKey,
    log.decoded.listingID,
    log.decoded.offerID
  ].join('-')
}
const getListingDetails = async log => {
  return {
    listing: await o.marketplace.getListing(listingId(log))
  }
}
const getOfferDetails = async log => {
  return {
    listing: await o.marketplace.getListing(listingId(log)),
    offer: await o.marketplace.getOffer(offerId(log))
  }
}

// Rules for acting on events
// Adding a rule here makes the listener listen for the event.
const LISTEN_RULES = {
  v00_MarketplaceContract: {
    ListingCreated: getListingDetails,
    ListingUpdated: getListingDetails,
    ListingWithdrawn: getListingDetails,
    ListingData: getListingDetails,
    ListingArbitrated: getListingDetails,
    OfferCreated: getListingDetails,
    OfferWithdrawn: getOfferDetails,
    OfferAccepted: getOfferDetails,
    OfferDisputed: getOfferDetails,
    OfferRuling: getOfferDetails,
    OfferFinalized: getOfferDetails,
    OfferData: getOfferDetails
  },
  v01_MarketplaceContract: {
    ListingCreated: getListingDetails,
    ListingUpdated: getListingDetails,
    ListingWithdrawn: getListingDetails,
    ListingData: getListingDetails,
    ListingArbitrated: getListingDetails,
    OfferCreated: getListingDetails,
    OfferWithdrawn: getOfferDetails,
    OfferAccepted: getOfferDetails,
    OfferDisputed: getOfferDetails,
    OfferRuling: getOfferDetails,
    OfferFinalized: getOfferDetails,
    OfferData: getOfferDetails
  }
}

// -------------------------------
// Section 2: The following engine
// -------------------------------

// liveTracking
// - checks for a new block every checkIntervalSeconds
// - if new block appeared, look for all events after the last found event
async function liveTracking() {
  console.log('Lobs')
  const context = await new Context().init()
  console.log('Lookup tables created')

  let lastLogBlock = 0
  let lastCheckedBlock = 0
  const checkIntervalSeconds = 5
  let start

  check = async () => {
    start = new Date()
    const currentBlockNumber = await web3.eth.getBlockNumber()
    if (currentBlockNumber == lastCheckedBlock) {
      return scheduleNextCheck()
    }
    console.log('New block: ' + currentBlockNumber)
    const opts = { fromBlock: lastLogBlock + 1 }
    const batchLastLogBlock = await runBatch(opts, context)
    if (batchLastLogBlock != undefined) {
      lastLogBlock = batchLastLogBlock
    }
    lastCheckedBlock = currentBlockNumber
    return scheduleNextCheck()
  }
  scheduleNextCheck = async () => {
    const elapsed = new Date() - start
    delay = Math.max(checkIntervalSeconds * 1000 - elapsed, 1)
    setTimeout(check, delay)
  }

  check()
}

// runBatch - gets and processes logs for a range of blocks
async function runBatch(opts, context) {
  const fromBlock = opts.fromBlock
  const toBlock = opts.toBlock
  let lastLogBlock = undefined

  console.log(
    'Looking for logs from block ' + fromBlock + ' to ' + (toBlock || 'Latest')
  )

  const eventTopics = Object.keys(context.signatureToRules)
  const logs = await web3.eth.getPastLogs({
    fromBlock: fromBlock,
    toBlock: toBlock,
    topics: [eventTopics]
  })

  for (const log of logs) {
    const contractVersion = context.addressToVersion[log.address]
    if (contractVersion == undefined) {
      continue // Skip - Not a trusted contract
    }
    const contractName = contractVersion.contractName
    const rule = context.signatureToRules[log.topics[0]][contractName]
    if (rule == undefined) {
      continue // Skip - No handler defined
    }
    lastLogBlock = log.blockNumber
    // Process it
    await handleLog(log, rule, contractVersion, context)
  }
  if (logs.length > 0) {
    console.log('' + logs.length + ' logs found')
  }
  return lastLogBlock
}

// Handles running annotating and running rules for a particular log
async function handleLog(log, rule, contractVersion, context) {
  log.decoded = web3.eth.abi.decodeLog(
    rule.eventAbi.inputs,
    log.data,
    log.topics.slice(1)
  )
  log.contractName = contractVersion.contractName
  log.eventName = rule.eventName
  log.contractVersionKey = contractVersion.versionKey
  log.networkId = context.networkId

  const output = {
    log: log,
    related: await rule.ruleFn(log)
  }

  process.stdout.write(JSON.stringify(output, null, 2))
  process.stdout.write('\n----\n')
}

// -------------------------------------------------------------------
// Section 3: Getting the contract information we need to track events
// -------------------------------------------------------------------

class Context {
  constructor() {
    this.signatureToRules = undefined
    this.addressToVersion = undefined
    this.networkId = undefined
  }

  async init() {
    this.signatureToRules = buildSignatureLookup()
    this.addressToVersion = await buildVersionList()
    this.networkId = await web3.eth.net.getId()
    return this
  }
}

function buildSignatureLookup() {
  const signatureLookup = {}
  for (const contractName in LISTEN_RULES) {
    const eventRules = LISTEN_RULES[contractName]
    const contract = o.contractService[contractName]
    contract.abi.filter(x => x.type == 'event').forEach(eventAbi => {
      const ruleFn = eventRules[eventAbi.name]
      if (ruleFn == undefined) {
        return
      }
      const signature = web3.eth.abi.encodeEventSignature(eventAbi)
      if (signatureLookup[signature] == undefined) {
        signatureLookup[signature] = {}
      }
      signatureLookup[signature][contractName] = {
        contractName: contractName,
        eventName: eventAbi.name,
        eventAbi: eventAbi,
        ruleFn: ruleFn
      }
    })
  }
  return signatureLookup
}

async function buildVersionList() {
  const versionList = {}
  const adapters = o.marketplace.adapters
  const versionKeys = Object.keys(adapters)
  for (const versionKey of versionKeys) {
    const adapter = adapters[versionKey]
    await adapter.getContract()
    const contract = adapter.contract
    versionList[contract._address] = {
      versionKey: versionKey,
      contractName: adapter.contractName
    }
  }
  return versionList
}

// ---------------------------
// Section 4: Run the listener
// ---------------------------

liveTracking()