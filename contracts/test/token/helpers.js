const EternalStorage = artifacts.require('EternalStorage')
const OriginTokenMock = artifacts.require('OriginTokenMock')

// Returns a newly deployed OriginToken with the specified parameters.
//
// owner and initialBalance are both optional.
const newOriginToken = async (owner, initialSupply) => {
  owner = Object.is(owner, undefined) ? web3.eth.accounts[0] : owner
  const es = await EternalStorage.new({from: owner})
  let token = await OriginTokenMock.new(es.address, {from: owner})
  await es.addWriter(token.address, {from: owner})
  if (initialSupply !== undefined) {
    await token.initialize(owner, initialSupply, {from: owner})
  }
  return token
}

module.exports = {
  newOriginToken
}