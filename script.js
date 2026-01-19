// 1. FIREBASE SETUP
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBqE5CKzZ4k7_gVICN0KpRIa9dJcoqaPuo", 
  authDomain: "axiom-invest.firebaseapp.com",
  projectId: "axiom-invest",
  storageBucket: "axiom-invest.firebasestorage.app",
  messagingSenderId: "1027219828712",
  appId: "1:1027219828712:web:4db0c16c729d278ebc3e5d",
  measurementId: "G-LC8THBHDV7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 2. SYSTEM VARIABLES
let ws;
let apiToken = "";
let isTrading = false;
let isTradeInProgress = false;
let balance = 0, startBalance = 0, totalProfit = 0;
let tickHistory = []; 

// USER VARIABLES
let userDocId = null;
let isPaidUser = false;
let dailyTradeCount = 0;
let lastTradeDateStr = "";

// TRADING INTELLIGENCE VARIABLES
let currentStake = 0.35; // Start Stake
let martingaleMultiplier = 1.4; 
let activeStrategy = null; 
let lastTradeStatus = null; 

let settings = { 
    baseStake: 0.35, 
    maxStake: 10, 
    target: 0.5, 
    stopL: 2.6  
};

// 3. THE 30 STRATEGIES (BANK OF KNOWLEDGE - EXTENDED)
// Functions for Logic
const getLast = (t) => t[t.length-1];
const getPrev = (t, n=2) => t[t.length-n];

const STRATEGY_BANK = {
    // --- BASIC RSI & SMA (1-5) ---
    "RSI_OVERSOLD": (t, rsi, sma) => rsi < 20 ? "CALL" : null,
    "RSI_OVERBOUGHT": (t, rsi, sma) => rsi > 80 ? "PUT" : null,
    "SMA_CROSS_UP": (t, rsi, sma) => (getPrev(t) < sma && getLast(t) > sma) ? "CALL" : null,
    "SMA_CROSS_DOWN": (t, rsi, sma) => (getPrev(t) > sma && getLast(t) < sma) ? "PUT" : null,
    "TREND_FOLLOW_UP": (t, rsi, sma) => (getLast(t) > sma && rsi > 55 && rsi < 70) ? "CALL" : null,

    // --- MOMENTUM & PATTERNS (6-10) ---
    "TREND_FOLLOW_DOWN": (t, rsi, sma) => (getLast(t) < sma && rsi < 45 && rsi > 30) ? "PUT" : null,
    "3_SOLDIERS": (t, rsi, sma) => (t[t.length-1] > t[t.length-2] && t[t.length-2] > t[t.length-3]) ? "CALL" : null,
    "3_CROWS": (t, rsi, sma) => (t[t.length-1] < t[t.length-2] && t[t.length-2] < t[t.length-3]) ? "PUT" : null,
    "SHARP_DROP_REBOUND": (t, rsi, sma) => (getLast(t) < getPrev(t) - 0.8) ? "CALL" : null,
    "SHARP_RISE_CORRECT": (t, rsi, sma) => (getLast(t) > getPrev(t) + 0.8) ? "PUT" : null,

    // --- BOLLINGER BAND SIMULATION (11-15) ---
    "BB_LOW_BREAK": (t, rsi, sma, sd) => (getLast(t) < sma - (2*sd)) ? "CALL" : null,
    "BB_HIGH_BREAK": (t, rsi, sma, sd) => (getLast(t) > sma + (2*sd)) ? "PUT" : null,
    "BB_SQUEEZE_UP": (t, rsi, sma, sd) => (sd < 0.05 && getLast(t) > sma) ? "CALL" : null,
    "BB_SQUEEZE_DOWN": (t, rsi, sma, sd) => (sd < 0.05 && getLast(t) < sma) ? "PUT" : null,
    "MID_REVERSION_UP": (t, rsi, sma) => (getLast(t) < sma && rsi < 30) ? "CALL" : null,

    // --- ADVANCED PATTERNS (16-20) ---
    "MID_REVERSION_DOWN": (t, rsi, sma) => (getLast(t) > sma && rsi > 70) ? "PUT" : null,
    "DOUBLE_TOP": (t, rsi, sma) => (Math.abs(getLast(t) - getPrev(t,3)) < 0.02 && rsi > 75) ? "PUT" : null,
    "DOUBLE_BOTTOM": (t, rsi, sma) => (Math.abs(getLast(t) - getPrev(t,3)) < 0.02 && rsi < 25) ? "CALL" : null,
    "STOCHASTIC_BUY": (t, rsi, sma) => (rsi < 20 && getLast(t) > getPrev(t)) ? "CALL" : null,
    "STOCHASTIC_SELL": (t, rsi, sma) => (rsi > 80 && getLast(t) < getPrev(t)) ? "PUT" : null,

    // --- AGGRESSIVE SCALPING (21-25) ---
    "SCALP_UP": (t, rsi, sma) => (getLast(t) > getPrev(t) && getLast(t) > sma) ? "CALL" : null,
    "SCALP_DOWN": (t, rsi, sma) => (getLast(t) < getPrev(t) && getLast(t) < sma) ? "PUT" : null,
    "HAMMER_MIMIC": (t, rsi, sma) => (getLast(t) > getPrev(t) && getPrev(t) < getPrev(t,2)) ? "CALL" : null,
    "SHOOTING_STAR_MIMIC": (t, rsi, sma) => (getLast(t) < getPrev(t) && getPrev(t) > getPrev(t,2)) ? "PUT" : null,
    "INSIDE_BAR_BREAK_UP": (t, rsi, sma) => (Math.abs(getPrev(t) - getPrev(t,2)) < 0.1 && getLast(t) > getPrev(t)) ? "CALL" : null,

    // --- VOLATILITY & NOISE (26-30) ---
    "INSIDE_BAR_BREAK_DOWN": (t, rsi, sma) => (Math.abs(getPrev(t) - getPrev(t,2)) < 0.1 && getLast(t) < getPrev(t)) ? "PUT" : null,
    "NOISE_FILTER_CALL": (t, rsi, sma) => (rsi > 50 && rsi < 55 && getLast(t) > sma) ? "CALL" : null,
    "NOISE_FILTER_PUT": (t, rsi, sma) => (rsi < 50 && rsi > 45 && getLast(t) < sma) ? "PUT" : null,
    "GAP_UP_FILL": (t, rsi, sma) => (getLast(t) > getPrev(t) + 0.5) ? "PUT" : null,
    "GAP_DOWN_FILL": (t, rsi, sma) => (getLast(t) < getPrev(t) - 0.5) ? "CALL" : null
};

// 4. USER LOGIN & LOGIC
window.checkUserAndLogin = async () => {
    const t = document.getElementById('api-token').value.trim();
    if(!t) return alert("Ampidiro ny Token!");
    apiToken = t;
    
    try {
        const userRef = doc(db, "users", apiToken);
        const userSnap = await getDoc(userRef);
        const now = new Date();

        if (userSnap.exists()) {
            const data = userSnap.data();
            isPaidUser = data.isPaid || false;
            lastTradeDateStr = data.lastTradeDateStr || "";
            dailyTradeCount = data.dailyTradeCount || 0;

            const todayStr = now.toDateString();
            if(lastTradeDateStr !== todayStr) {
                dailyTradeCount = 0;
                await updateDoc(userRef, { dailyTradeCount: 0, lastTradeDateStr: todayStr });
            }

            // Trial Check
            const startDate = data.startDate.toDate();
            const diffDays = Math.ceil(Math.abs(now - startDate) / (1000 * 60 * 60 * 24)); 
            if (diffDays > 2 && !isPaidUser) {
                document.getElementById('payment-lock').classList.remove('hidden');
                return;
            }
        } else {
            // New User
            await setDoc(userRef, {
                startDate: serverTimestamp(),
                isPaid: false,
                dailyTradeCount: 0,
                lastTradeDateStr: now.toDateString()
            });
            alert("Bienvenue! 2 andro andrana maimaim-poana.");
        }
        
        userDocId = apiToken;
        connectDeriv();
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('main-app').classList.remove('hidden');
        initChart();

    } catch (error) {
        console.error("Auth Error:", error);
        alert("Olana connexion. Hamarino ny internet.");
    }
};

window.submitPayment = async () => {
    const ref = document.getElementById('payment-ref').value;
    if(!ref) return alert("Ampidiro ny Reference!");
    await addDoc(collection(db, "payment_requests"), { token: apiToken, ref: ref, date: serverTimestamp(), status: "pending" });
    alert("Voaray. Miandrasa validation.");
};

// 5. TRADING CONTROL
window.startBot = () => {
    // Limit Check for Free Users
    if(isPaidUser === false && dailyTradeCount >= 20) { // Increased limit a bit for testing
        alert("Limit Journalier tratra.");
        return;
    }

    if(totalProfit >= settings.target) {
        alert("Efa tratra ny objectif! Reset ny pejy raha te hamerina.");
        return;
    }

    // Reset raha vao manomboka
    if(!isTradeInProgress && lastTradeStatus !== 'LOSS') {
        currentStake = settings.baseStake;
    }
    
    isTrading = true;
    document.getElementById('start-btn').disabled = true;
    document.getElementById('stop-btn').disabled = false;
    document.getElementById('scan-line').classList.remove('hidden');
    
    document.getElementById('ai-status').innerText = "🔍 AI: Scanning Market...";
    document.getElementById('ai-status').style.color = "#d29922"; 
    addLog("🚀 AI STARTED. Dynamic Mode Activated.");
};

window.stopBot = (reason = "User Stop") => {
    isTrading = false;
    document.getElementById('start-btn').disabled = false;
    document.getElementById('stop-btn').disabled = true;
    document.getElementById('scan-line').classList.add('hidden');
    document.getElementById('ai-status').innerText = "🛑 AI: Stopped";
    document.getElementById('ai-status').style.color = "#f85149";
    addLog(`🛑 STOPPED: ${reason}`);
};

// 6. DERIV WEBSOCKET
function connectDeriv() {
    ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    
    ws.onopen = () => ws.send(JSON.stringify({ authorize: apiToken }));

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);

        if(data.msg_type === 'authorize') {
            balance = parseFloat(data.authorize.balance);
            startBalance = balance;
            updateUIBalance();
            ws.send(JSON.stringify({ ticks: 'R_100', subscribe: 1 }));
        }

        if(data.msg_type === 'tick') {
            const price = data.tick.quote;
            updateChart(price);
            
            // IMMEDIATE RE-ANALYSIS logic
            if(isTrading && !isTradeInProgress) {
                brainProcess(price);
            }
        }

        if(data.msg_type === 'buy') {
            isTradeInProgress = true;
            addLog(`⚡ TRADE EXEC: $${currentStake} (ID: ${data.buy.contract_id})`);
            
            dailyTradeCount++;
            // Optional: Update DB sparsely to save writes
            
            // Subscribe to open contract for INSTANT result
            ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
        }

        if(data.msg_type === 'proposal_open_contract') {
            const contract = data.proposal_open_contract;
            // Check immediately if sold
            if(contract.is_sold) {
                isTradeInProgress = false;
                processResult(contract);
            }
        }
    };
}

// 7. THE INTELLIGENT BRAIN (CORE LOGIC)
function brainProcess(currentPrice) {
    // Safety Checks
    if(totalProfit >= settings.target) { stopBot("Target Profit Reached"); return; }
    if(totalProfit <= -settings.stopL) { stopBot("Stop Loss Reached"); return; }

    tickHistory.push(currentPrice);
    if(tickHistory.length > 50) tickHistory.shift(); 
    if(tickHistory.length < 15) return; 

    // Calculs Techniques (Fast)
    const rsi = calculateRSI(tickHistory, 14);
    const sma = calculateSMA(tickHistory, 20);
    const sd = calculateSD(tickHistory, 20, sma); // Standard Deviation for Bollinger

    document.getElementById('decision-overlay').innerText = `RSI:${rsi.toFixed(0)} | SMA:${sma.toFixed(2)}`;
    
    // DYNAMIC STRATEGY SELECTION
    // We do not stick to one strategy. We scan ALL 30 every tick.
    let bestSignal = null;
    let bestStratName = null;

    // Shuffle keys to give random chance if multiple strategies match? 
    // No, systematic check is faster.
    for (const [name, logicFunc] of Object.entries(STRATEGY_BANK)) {
        const signal = logicFunc(tickHistory, rsi, sma, sd);
        if (signal) {
            bestSignal = signal;
            bestStratName = name;
            break; // Stop at first valid signal for speed
        }
    }

    if (bestSignal) {
        activeStrategy = bestStratName;
        document.getElementById('current-strategy-badge').innerText = activeStrategy;
        document.getElementById('ai-status').innerText = "⚡ EXECUTION...";
        document.getElementById('ai-status').style.color = "#3fb950";
        placeTrade(bestSignal);
    } else {
        document.getElementById('ai-status').innerText = "👀 Scanning (30 Strat)...";
        document.getElementById('ai-status').style.color = "#d29922";
    }
}

function placeTrade(type) {
    // 0.1s execution logic is handled by calling this function immediately from brainProcess
    addLog(`🤖 Signal: ${type} | Strat: ${activeStrategy}`);
    ws.send(JSON.stringify({
        buy: 1,
        price: currentStake,
        parameters: { 
            amount: currentStake, 
            basis: 'stake', 
            contract_type: type, 
            currency: 'USD', 
            duration: 1, // Ultra short duration if possible, or 5 ticks
            duration_unit: 't', 
            symbol: 'R_100' 
        }
    }));
}

// 8. RESULT & DYNAMIC RESTART
async function processResult(contract) {
    const profit = parseFloat(contract.profit);
    totalProfit += profit;
    updateUIBalance();
    
    const isWin = profit >= 0;
    lastTradeStatus = isWin ? 'WIN' : 'LOSS';

    // 1. Play Sound
    if(isWin) document.getElementById('sound-win').play();
    else document.getElementById('sound-loss').play();

    // 2. Add to History with DATE & BADGE
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-GB'); // HH:MM:SS
    const dateString = now.toLocaleDateString('en-GB'); // DD/MM/YYYY
    
    const li = document.createElement('li');
    const badgeClass = isWin ? 'badge-win' : 'badge-loss';
    const sign = isWin ? '+' : '';
    
    li.className = isWin ? 'win' : 'loss';
    li.innerHTML = `
        <div class="history-left">
             <div class="history-strat">${activeStrategy || 'Unknown'}</div>
             <div class="history-time">${dateString} ${timeString}</div>
        </div>
        <div class="history-right">
            <span class="history-amount">${sign}$${Math.abs(profit).toFixed(2)}</span>
            <span class="badge ${badgeClass}">${isWin ? 'WIN' : 'LOSS'}</span>
        </div>
    `;
    document.getElementById('history-list').prepend(li);
    document.getElementById('total-pl-display').innerText = totalProfit.toFixed(2);

    // 3. IMPORTANT: RESET STRATEGY FOR NEXT TRADE
    activeStrategy = null; // Force AI to re-analyze completely

    // 4. CHECK TARGETS
    if (totalProfit >= settings.target) {
         // Target Hit -> STOP
         stopBot("Target Profit Reached");
         const modal = document.getElementById('win-modal');
         document.getElementById('win-message').innerHTML = `Tombony azo: <b style="color:#3fb950">$${totalProfit.toFixed(2)}</b>.`;
         modal.classList.remove('hidden');
         return;
    }

    // 5. MANAGE STAKE (Martingale) & CONTINUE
    if (isWin) {
        addLog(`✅ WIN. Reset Stake to $${settings.baseStake}. Continuing...`);
        currentStake = settings.baseStake;
    } else {
        let nextStake = currentStake * martingaleMultiplier;
        currentStake = Math.round(nextStake * 100) / 100;
        addLog(`❌ LOSS. Martingale x1.4 -> $${currentStake}. Immediate Retry.`);
    }

    // Bot remains isTrading = true, so next tick triggers brainProcess automatically
}

window.closeWinModal = () => {
    document.getElementById('win-modal').classList.add('hidden');
};

// 9. HELPER FUNCTIONS
function calculateSMA(data, period) {
    if(data.length < period) return data[data.length-1];
    let sum = 0;
    for(let i = data.length - period; i < data.length; i++) sum += data[i];
    return sum / period;
}

function calculateSD(data, period, sma) {
    if(data.length < period) return 0;
    let sumSq = 0;
    for(let i = data.length - period; i < data.length; i++) {
        sumSq += Math.pow(data[i] - sma, 2);
    }
    return Math.sqrt(sumSq / period);
}

function calculateRSI(data, period) {
    if(data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length - 1; i++) {
        const diff = data[i+1] - data[i];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function updateUIBalance() {
    document.getElementById('balance-display').innerText = `$${(startBalance + totalProfit).toFixed(2)}`;
}

function addLog(msg) {
    const ul = document.getElementById('log-list');
    const li = document.createElement('li');
    const timestamp = new Date().toLocaleTimeString().split(' ')[0];
    li.innerHTML = `<span style="color:#58a6ff">[${timestamp}]</span> ${msg}`;
    ul.prepend(li);
}

// 10. TABS & CHART
window.switchTab = (id) => {
    document.querySelectorAll('.tab-content').forEach(d => d.classList.remove('active'));
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    event.currentTarget.classList.add('active');
};

let chart;
function initChart() {
    const ctx = document.getElementById('tradingChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(30).fill(''),
            datasets: [{
                label: 'Price', data: Array(30).fill(null),
                borderColor: '#58a6ff', borderWidth: 2, tension: 0.1, pointRadius: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false } },
            animation: false
        }
    });
}
function updateChart(price) {
    if(!chart) return;
    chart.data.datasets[0].data.push(price);
    chart.data.datasets[0].data.shift();
    chart.update();
}
