import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface LotteryData {
  id: string;
  name: string;
  encryptedNumber: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

interface LotteryStats {
  totalLotteries: number;
  verifiedLotteries: number;
  activePlayers: number;
  totalPrize: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [lotteries, setLotteries] = useState<LotteryData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLottery, setCreatingLottery] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newLotteryData, setNewLotteryData] = useState({ 
    name: "", 
    number: "", 
    description: "" 
  });
  const [selectedLottery, setSelectedLottery] = useState<LotteryData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<LotteryData[]>([]);
  const [stats, setStats] = useState<LotteryStats>({
    totalLotteries: 0,
    verifiedLotteries: 0,
    activePlayers: 0,
    totalPrize: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const lotteriesList: LotteryData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          lotteriesList.push({
            id: businessId,
            name: businessData.name,
            encryptedNumber: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading lottery data:', e);
        }
      }
      
      setLotteries(lotteriesList);
      updateStats(lotteriesList);
      if (address) {
        setUserHistory(lotteriesList.filter(lottery => lottery.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (lotteries: LotteryData[]) => {
    const total = lotteries.length;
    const verified = lotteries.filter(l => l.isVerified).length;
    const uniquePlayers = new Set(lotteries.map(l => l.creator)).size;
    const totalPrize = lotteries.reduce((sum, l) => sum + l.publicValue1, 0);
    
    setStats({
      totalLotteries: total,
      verifiedLotteries: verified,
      activePlayers: uniquePlayers,
      totalPrize: totalPrize
    });
  };

  const createLottery = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLottery(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating lottery with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const numberValue = parseInt(newLotteryData.number) || 0;
      const businessId = `lottery-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, numberValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLotteryData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 1000),
        0,
        newLotteryData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Lottery created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLotteryData({ name: "", number: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLottery(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Lottery number decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">🎰</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalLotteries}</div>
            <div className="stat-label">Total Lotteries</div>
          </div>
        </div>
        
        <div className="stat-card neon-blue">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verifiedLotteries}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <div className="stat-value">{stats.activePlayers}</div>
            <div className="stat-label">Active Players</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalPrize}</div>
            <div className="stat-label">Total Prize</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Choose & Encrypt</h4>
            <p>Select your lucky number, encrypted with FHE 🔐</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted number stored securely on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Draw</h4>
            <p>Compare numbers without decryption using FHE</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Verify & Claim</h4>
            <p>Decrypt and verify your win privately</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎰 Private Lottery FHE</h1>
            <p>Fully Homomorphic Encrypted Lottery System</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔐</div>
                <h3>Encrypted Selection</h3>
                <p>Your lottery numbers are fully encrypted using FHE technology</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🎯</div>
                <h3>Fair Drawing</h3>
                <p>Homomorphic comparison ensures fair and transparent results</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🤫</div>
                <h3>Complete Privacy</h3>
                <p>Your numbers remain private until you choose to reveal them</p>
              </div>
            </div>
            
            <div className="connect-prompt">
              <h2>Connect Your Wallet to Start Playing</h2>
              <p>Experience the future of private lottery with FHE technology</p>
              <div className="wallet-connect-center">
                <ConnectButton />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your lottery experience</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading Private Lottery System...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎰 Private Lottery FHE</h1>
          <p>Fully Homomorphic Encrypted Lottery</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn neon-glow"
          >
            + New Lottery
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        <section className="stats-section">
          <h2>Lottery Statistics</h2>
          {renderStats()}
        </section>

        <section className="process-section">
          <div className="section-header">
            <h2>FHE Lottery Process</h2>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "🔄 Refresh"}
            </button>
          </div>
          {renderFHEProcess()}
        </section>

        <div className="content-grid">
          <section className="lotteries-section">
            <div className="section-header">
              <h2>Active Lotteries</h2>
              <span className="section-badge">{lotteries.length}</span>
            </div>
            
            <div className="lotteries-list">
              {lotteries.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎰</div>
                  <p>No active lotteries found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Lottery
                  </button>
                </div>
              ) : (
                lotteries.map((lottery, index) => (
                  <div 
                    className={`lottery-item ${selectedLottery?.id === lottery.id ? "selected" : ""}`}
                    key={index}
                    onClick={() => setSelectedLottery(lottery)}
                  >
                    <div className="lottery-header">
                      <h3>{lottery.name}</h3>
                      <span className={`status-badge ${lottery.isVerified ? "verified" : "encrypted"}`}>
                        {lottery.isVerified ? "✅ Verified" : "🔐 Encrypted"}
                      </span>
                    </div>
                    <div className="lottery-details">
                      <div className="detail-item">
                        <span>Prize Pool:</span>
                        <strong>{lottery.publicValue1} ETH</strong>
                      </div>
                      <div className="detail-item">
                        <span>Created:</span>
                        <span>{new Date(lottery.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="lottery-creator">
                      Creator: {lottery.creator.substring(0, 8)}...{lottery.creator.substring(36)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="user-section">
            <div className="section-header">
              <h2>Your Lottery History</h2>
              <span className="section-badge">{userHistory.length}</span>
            </div>
            
            <div className="user-history">
              {userHistory.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📝</div>
                  <p>No lottery history found</p>
                  <p className="empty-hint">Create your first lottery to get started!</p>
                </div>
              ) : (
                userHistory.map((lottery, index) => (
                  <div className="history-item" key={index}>
                    <div className="history-main">
                      <span className="history-name">{lottery.name}</span>
                      <span className={`history-status ${lottery.isVerified ? "won" : "pending"}`}>
                        {lottery.isVerified ? `Won: ${lottery.decryptedValue}` : "Pending"}
                      </span>
                    </div>
                    <div className="history-date">
                      {new Date(lottery.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="faq-section">
              <h3>FHE Lottery FAQ</h3>
              <div className="faq-item">
                <div className="faq-question">How does FHE protect my privacy?</div>
                <div className="faq-answer">
                  Your lottery numbers are encrypted using Fully Homomorphic Encryption, 
                  allowing computations without decryption.
                </div>
              </div>
              <div className="faq-item">
                <div className="faq-question">When can I decrypt my number?</div>
                <div className="faq-answer">
                  You can decrypt and verify your number anytime after the lottery draw.
                </div>
              </div>
              <div className="faq-item">
                <div className="faq-question">Is the system fair?</div>
                <div className="faq-answer">
                  Yes! FHE ensures fair comparison without revealing any numbers until verification.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showCreateModal && (
        <CreateLotteryModal 
          onSubmit={createLottery} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingLottery} 
          lotteryData={newLotteryData} 
          setLotteryData={setNewLotteryData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedLottery && (
        <LotteryDetailModal 
          lottery={selectedLottery} 
          onClose={() => setSelectedLottery(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedLottery.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateLotteryModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  lotteryData: any;
  setLotteryData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, lotteryData, setLotteryData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'number') {
      const intValue = value.replace(/[^\d]/g, '');
      setLotteryData({ ...lotteryData, [name]: intValue });
    } else {
      setLotteryData({ ...lotteryData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Lottery</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Lottery</strong>
              <p>Your lucky number will be encrypted using Zama FHE technology</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Lottery Name *</label>
            <input 
              type="text" 
              name="name" 
              value={lotteryData.name} 
              onChange={handleChange} 
              placeholder="Enter lottery name..." 
              className="neon-input"
            />
          </div>
          
          <div className="form-group">
            <label>Lucky Number (1-100) *</label>
            <input 
              type="number" 
              name="number" 
              min="1" 
              max="100"
              value={lotteryData.number} 
              onChange={handleChange} 
              placeholder="Enter your lucky number..."
              className="neon-input"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={lotteryData.description} 
              onChange={handleChange} 
              placeholder="Optional description..."
              className="neon-input"
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !lotteryData.name || !lotteryData.number} 
            className="submit-btn neon-glow"
          >
            {creating || isEncrypting ? "🔐 Encrypting..." : "Create Lottery"}
          </button>
        </div>
      </div>
    </div>
  );
};

const LotteryDetailModal: React.FC<{
  lottery: LotteryData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ lottery, onClose, isDecrypting, decryptData }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await decryptData();
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Lottery Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="lottery-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{lottery.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <span>{lottery.creator.substring(0, 8)}...{lottery.creator.substring(36)}</span>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <span>{new Date(lottery.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span>Prize Pool:</span>
              <strong className="prize-amount">{lottery.publicValue1} ETH</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>Encrypted Number</h3>
            <div className="encryption-status">
              <div className="status-indicator">
                <div className={`status-dot ${lottery.isVerified ? "verified" : "encrypted"}`}></div>
                <span>Status: {lottery.isVerified ? "Verified" : "Encrypted"}</span>
              </div>
              
              <div className="number-display">
                {lottery.isVerified ? (
                  <div className="decrypted-number">
                    <span>Your Number: </span>
                    <strong className="win-number">{lottery.decryptedValue}</strong>
                  </div>
                ) : localDecrypted !== null ? (
                  <div className="decrypted-number">
                    <span>Your Number: </span>
                    <strong className="win-number">{localDecrypted}</strong>
                  </div>
                ) : (
                  <div className="encrypted-number">
                    <span>🔐 FHE Encrypted</span>
                    <div className="encrypted-blob">•••••••</div>
                  </div>
                )}
              </div>
            </div>
            
            {!lottery.isVerified && (
              <button 
                className={`decrypt-btn ${localDecrypted !== null ? "decrypted" : ""}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Decrypting..." : 
                 localDecrypted !== null ? "✅ Decrypted" : "🔓 Decrypt Number"}
              </button>
            )}
          </div>
          
          {lottery.description && (
            <div className="description-section">
              <h3>Description</h3>
              <p>{lottery.description}</p>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!lottery.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn neon-glow"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

