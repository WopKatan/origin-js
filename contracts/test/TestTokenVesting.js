const Token = artifacts.require('Token')
const TokenVesting = artifacts.require('TokenVesting')

const moment = require('moment')

const timeTravel = async function(delta) {
  await web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [delta],
    id: 0
  })
  await web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_mine',
    params: [],
    id: 0
  })
}

async function blockTimestamp() {
  const block = await web3.eth.getBlock('latest');
  return block.timestamp;
}

contract('TestVesting', ([owner, beneficiary]) => {
  const initialSupply = 100000
  let token
  let startUnix
  let start

  beforeEach(async function() {
    token = await Token.new('Token', 'TKN', 0, initialSupply, {from: owner})
    startUnix = await blockTimestamp()
    start = moment.unix(startUnix)
  })

  it('vests monthly over 4 years with a 1 year cliff', async function() {
    const vestingCliff = start.clone().add(1, 'year')
    let vestingTimestamps = []
    for (let i = 1; i <= 36; i++) {
      const vestingTimestamp = vestingCliff.clone().add(i, 'month')
      vestingTimestamps.push(vestingTimestamp.unix())
    }

    const vesting = await TokenVesting.new(
      beneficiary,
      token.address,
      vestingCliff.unix(),
      1200,
      vestingTimestamps,
      100
    )

    const cliffSeconds = vestingCliff.unix() - await blockTimestamp()
    await timeTravel(cliffSeconds - 1)
    let vestedBeforeCliff = await vesting.vested()
    assert.equal(vestedBeforeCliff, 0)
    await timeTravel(1)
    let vestedAfterCliff = await vesting.vested()
    assert.equal(vestedAfterCliff, 1200)
  })
})
