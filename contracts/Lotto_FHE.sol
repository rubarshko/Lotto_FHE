pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LottoFHE is ZamaEthereumConfig {
    struct Ticket {
        euint32 encryptedNumbers;
        address player;
        uint256 timestamp;
        uint32 decryptedNumbers;
        bool isVerified;
        bool isWinner;
    }

    struct Lottery {
        uint256 ticketPrice;
        uint256 prizePool;
        uint32 winningNumbers;
        uint256 drawTimestamp;
        bool isDrawn;
    }

    mapping(uint256 => Lottery) public lotteries;
    mapping(uint256 => Ticket[]) public lotteryTickets;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    uint256 public nextLotteryId = 1;
    uint256 public constant MAX_NUMBERS = 6;
    uint256 public constant MAX_NUMBER_VALUE = 49;

    event LotteryCreated(uint256 indexed lotteryId, uint256 ticketPrice);
    event TicketPurchased(uint256 indexed lotteryId, address indexed player);
    event LotteryDrawn(uint256 indexed lotteryId, uint32 winningNumbers);
    event WinnerClaimed(uint256 indexed lotteryId, address indexed winner);

    constructor() ZamaEthereumConfig() {}

    function createLottery(uint256 ticketPrice) external {
        uint256 lotteryId = nextLotteryId++;
        lotteries[lotteryId] = Lottery({
            ticketPrice: ticketPrice,
            prizePool: 0,
            winningNumbers: 0,
            drawTimestamp: 0,
            isDrawn: false
        });
        emit LotteryCreated(lotteryId, ticketPrice);
    }

    function buyTicket(
        uint256 lotteryId,
        externalEuint32 encryptedNumbers,
        bytes calldata inputProof
    ) external payable {
        Lottery storage lottery = lotteries[lotteryId];
        require(lottery.ticketPrice > 0, "Lottery not exists");
        require(msg.value == lottery.ticketPrice, "Incorrect ticket price");

        require(FHE.isInitialized(FHE.fromExternal(encryptedNumbers, inputProof)), "Invalid encrypted input");

        lottery.prizePool += msg.value;
        lotteryTickets[lotteryId].push(Ticket({
            encryptedNumbers: FHE.fromExternal(encryptedNumbers, inputProof),
            player: msg.sender,
            timestamp: block.timestamp,
            decryptedNumbers: 0,
            isVerified: false,
            isWinner: false
        }));

        FHE.allowThis(lotteryTickets[lotteryId][lotteryTickets[lotteryId].length - 1].encryptedNumbers);
        FHE.makePubliclyDecryptable(lotteryTickets[lotteryId][lotteryTickets[lotteryId].length - 1].encryptedNumbers);

        emit TicketPurchased(lotteryId, msg.sender);
    }

    function drawLottery(
        uint256 lotteryId,
        uint32 winningNumbers,
        bytes[] calldata decryptionProofs
    ) external {
        Lottery storage lottery = lotteries[lotteryId];
        require(!lottery.isDrawn, "Lottery already drawn");
        require(winningNumbers > 0, "Invalid winning numbers");

        lottery.winningNumbers = winningNumbers;
        lottery.drawTimestamp = block.timestamp;
        lottery.isDrawn = true;

        for (uint256 i = 0; i < lotteryTickets[lotteryId].length; i++) {
            Ticket storage ticket = lotteryTickets[lotteryId][i];
            require(!ticket.isVerified, "Ticket already verified");

            bytes memory abiEncodedClearValue = abi.encode(winningNumbers);
            bytes32[] memory cts = new bytes32[](1);
            cts[0] = FHE.toBytes32(ticket.encryptedNumbers);

            FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProofs[i]);

            ticket.decryptedNumbers = winningNumbers;
            ticket.isVerified = true;
            ticket.isWinner = checkWinningNumbers(winningNumbers, ticket.decryptedNumbers);
        }

        emit LotteryDrawn(lotteryId, winningNumbers);
    }

    function claimPrize(uint256 lotteryId) external {
        Lottery storage lottery = lotteries[lotteryId];
        require(lottery.isDrawn, "Lottery not drawn");
        require(!hasClaimed[lotteryId][msg.sender], "Prize already claimed");

        for (uint256 i = 0; i < lotteryTickets[lotteryId].length; i++) {
            Ticket storage ticket = lotteryTickets[lotteryId][i];
            if (ticket.player == msg.sender && ticket.isWinner) {
                hasClaimed[lotteryId][msg.sender] = true;
                payable(msg.sender).transfer(lottery.prizePool / getWinnerCount(lotteryId));
                emit WinnerClaimed(lotteryId, msg.sender);
                break;
            }
        }
    }

    function getTicket(uint256 lotteryId, uint256 ticketIndex) external view returns (
        euint32 encryptedNumbers,
        address player,
        uint256 timestamp,
        uint32 decryptedNumbers,
        bool isVerified,
        bool isWinner
    ) {
        Ticket storage ticket = lotteryTickets[lotteryId][ticketIndex];
        return (
            ticket.encryptedNumbers,
            ticket.player,
            ticket.timestamp,
            ticket.decryptedNumbers,
            ticket.isVerified,
            ticket.isWinner
        );
    }

    function getLotteryTicketCount(uint256 lotteryId) external view returns (uint256) {
        return lotteryTickets[lotteryId].length;
    }

    function checkWinningNumbers(uint32 winning, uint32 ticket) internal pure returns (bool) {
        uint32[6] memory winningArr = convertToArray(winning);
        uint32[6] memory ticketArr = convertToArray(ticket);
        uint256 matchCount = 0;

        for (uint256 i = 0; i < winningArr.length; i++) {
            for (uint256 j = 0; j < ticketArr.length; j++) {
                if (winningArr[i] == ticketArr[j]) {
                    matchCount++;
                    break;
                }
            }
        }
        return matchCount >= 3;
    }

    function convertToArray(uint32 num) internal pure returns (uint32[6] memory) {
        uint32[6] memory arr;
        for (uint256 i = 0; i < 6; i++) {
            arr[i] = (num >> (5 - i) * 8) & 0xFF;
        }
        return arr;
    }

    function getWinnerCount(uint256 lotteryId) internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < lotteryTickets[lotteryId].length; i++) {
            if (lotteryTickets[lotteryId][i].isWinner) {
                count++;
            }
        }
        return count;
    }
}

