/* solium-disable security/no-block-members */

pragma solidity ^0.4.23;

import "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

// TODO: write informative comment here
contract TokenVesting is Ownable {
  using SafeMath for uint256;

  event Vested(uint256 amount);
  event Transferred(); // for transferring to new contract (for logic upgrade)
  event Revoked();
  event Debug(uint256 d);

  // Total number of tokens vested so far
  uint256 public released;
  // Address to which tokens are transferred during vesting
  address public beneficiary;
  // Whether this contract has been revoked (tokens refunded to owner)
  bool public revoked;

  // Token contract for this grant.
  ERC20 public token;
  // UNIX timestamp of vesting cliff
  uint256 public cliff;
  // Number of tokens vested at cliff
  uint256 public cliffAmount;
  // UNIX timestamps for all vesting event. For example, monthly vesting would
  // be represented by a set of timestamps one month apart.
  uint256[] public vestingTimestamps;
  // Number of tokens to vest as each time in vestingTimestamps elapses.
  uint256 public vestingAmount;

  constructor(
    address _beneficiary,
    ERC20 _token, // TODO: replace this with an ENS name!
    uint256 _cliff,
    uint256 _cliffAmount,
    uint256[] _vestingTimestamps,
    uint256 _vestingAmount
  )
    public
  {
    // Verify that the timestamps are in ascending order, because we rely on
    // that elsewhere.
    if (_vestingTimestamps.length > 0) {
      require(_vestingTimestamps[0] > _cliff, "vesting event must happen after cliff");
    }
    for (uint i = 1; i < _vestingTimestamps.length; i++) {
      require(
        _vestingTimestamps[i - 1] < _vestingTimestamps[i],
        "vesting timestamps must be in ascending order"
      );
    }
    require(_cliffAmount > 0 || _vestingAmount > 0, "vesting contract has no value");
    owner = msg.sender;
    released = 0;
    beneficiary = _beneficiary;
    token = _token;
    cliff = _cliff;
    cliffAmount = _cliffAmount;
    vestingTimestamps = _vestingTimestamps;
    vestingAmount = _vestingAmount;
  }

  function totalGrant() public view returns (uint256) {
    return cliffAmount.add(vestingAmount.mul(vestingTimestamps.length));
  }

  function unvested() public view returns (uint256) {
    return totalGrant().sub(vested());
  }

  function vest() public returns (uint256) {
    uint256 releasable = releasableAmount();
    if (releasable == 0) {
      return 0;
    }
    require(token.transfer(beneficiary, releasable), "transfer failed");
    emit Vested(releasable);
    return releasable;
  }

  function vested() public view returns (uint256) {
    if (now < cliff) {
      return 0;
    }
    uint256 v = cliffAmount;
    for (uint i = 0; i < vestingTimestamps.length; i++) {
      if (now < vestingTimestamps[i]) {
        break;
      }
      v = v.add(vestingAmount);
    }
    return v;
  }

  function releasableAmount() public view returns (uint256) {
    return vested().sub(released);
  }

  function revoke() public onlyOwner {
    require(!revoked);

    uint256 balance = token.balanceOf(address(this));
    uint256 unreleased = releasableAmount();
    uint256 refund = balance.sub(unreleased);
    revoked = true;
    require(token.transfer(owner, refund));
    emit Revoked();
  }
}
