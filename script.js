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
let tickHistory = []; // Hitehirizana ny vidy farany (Price Action)

// USER VARIABLES
let userDocId = null;
let isPaidUser = false;
let dailyTradeCount = 0;
let lastTradeDateStr = "";

// TRADING INTELLIGENCE VARIABLES
let currentStake = 1;
let martingaleMultiplier = 2; 
let activeStrategy = null; // Ilay strategie mandeha amin'izao
let lastTradeStatus = null; // 'WIN' or 'LOSS'

let settings = { 
    baseStake: 1, 
    maxStake: 5, // Sécurité
    target: 10, 
    stopL: 20 
};

// 3. THE 10 STRATEGIES (BANK OF KNOWLEDGE)
// Ireto no "saina" 10 samihafa
const STRATEGY_BANK = {
    "RSI_OVERSOLD": (ticks, rsi, sma) => { return rsi < 25 ? "CALL" : null; },
    "RSI_OVERBOUGHT": (ticks, rsi, sma) => { return rsi > 75 ? "PUT" : null; },
    "SMA_CROSS_UP": (ticks, rsi, sma) => { 
        let last = ticks[ticks.length-1]; let prev = ticks[ticks.length-2];
        return (prev < sma && last > sma) ? "CALL" : null;
    },
    "SMA_CROSS_DOWN": (ticks, rsi, sma) => {
        let last = ticks[ticks.length-1]; let prev = ticks[ticks.length-2];
        return (prev > sma && last < sma) ? "PUT" : null;
    },
    "MOMENTUM_BURST": (ticks, rsi, sma) => {
        // Raha misy fiakarana be tampoka
        let last = ticks[ticks.length-1]; let prev3 = ticks[ticks.length-4];
        if(last > prev3 + 0.5) return "CALL";
        if(last < prev3 - 0.5) return "PUT";
        return null;
    },
    "REVERSAL_EXTREME": (ticks, rsi, sma) => {
        // Raha lasa lavitra be niala tamin'ny SMA
        let last = ticks[ticks.length-1];
        if(last > sma + 1.5 && rsi > 80) return "PUT";
        if(last < sma - 1.5 && rsi < 20) return "CALL";
        return null;
    },
    "PATTERN_3_CROWS": (ticks, rsi, sma) => {
        // Nidina in-3 nifanesy
        let t = ticks; let l = t.length;
        if(t[l-1]<t[l-2] && t[l-2]<t[l-3] && rsi > 30) return "PUT";
        return null;
    },
    "PATTERN_3_SOLDIERS": (ticks, rsi, sma) => {
        // Niakatra in-3 nifanesy
        let t = ticks; let l = t.length;
        if(t[l-1]>t[l-2] && t[l-2]>t[l-3] && rsi < 70) return "CALL";
        return null;
    },
    "CONSERVATIVE_TREND": (ticks, rsi, sma) => {
        // Manaraka ny courant fotsiny
        let last = ticks[ticks.length-1];
        if(last > sma && rsi > 50 && rsi < 65) return "CALL";
        if(last < sma && rsi < 50 && rsi > 35) return "PUT";
        return null;
    },
    "RANGE_BREAKOUT": (ticks, rsi, sma) => {
        // Raha miala anaty range kely
        let last = ticks[ticks.length-1];
        let range = ticks.slice(-5); // 5 farany
        let max = Math.max(...range);
        let min = Math.min(...range);
        if(max - min < 0.2) return null; // Tsy mihetsika
        if(last === max) return "CALL";
        if(last === min) return "PUT";
        return null;
    }
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
    // Limit Check
    if(isPaidUser && dailyTradeCount >= 2) {
        alert("Limit Journalier tratra (2 trades).");
        return;
    }

    settings.baseStake = parseFloat(document.getElementById('stake-input').value);
    // Raha vao manomboka dia ny base no alaina
    if(!isTradeInProgress && lastTradeStatus !== 'LOSS') {
        currentStake = settings.baseStake;
    }
    
    settings.target = parseFloat(document.getElementById('target-profit').value);
    settings.stopL = parseFloat(document.getElementById('stop-loss').value);

    isTrading = true;
    document.getElementById('start-btn').disabled = true;
    document.getElementById('stop-btn').disabled = false;
    document.getElementById('scan-line').classList.remove('hidden');
    
    document.getElementById('ai-status').innerText = "🔍 AI: Scanning Market...";
    document.getElementById('ai-status').style.color = "#d29922"; // Yellow
    addLog("🚀 AI ACTIVATED. Analyzing conditions...");
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
            
            if(isTrading && !isTradeInProgress) {
                brainProcess(price);
            }
        }

        if(data.msg_type === 'buy') {
            isTradeInProgress = true;
            addLog(`⚡ TRADE SENT: $${currentStake} (ID: ${data.buy.contract_id})`);
            
            // Increment Limit
            dailyTradeCount++;
            const userRef = doc(db, "users", apiToken);
            updateDoc(userRef, { dailyTradeCount: dailyTradeCount });

            // Subscribe to open contract for Result
            setTimeout(() => ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 })), 1000);
        }

        if(data.msg_type === 'proposal_open_contract') {
            const contract = data.proposal_open_contract;
            if(contract.is_sold) {
                isTradeInProgress = false;
                processResult(contract);
            }
        }
    };
}

// 7. THE INTELLIGENT BRAIN (CORE LOGIC)
function brainProcess(currentPrice) {
    if(totalProfit >= settings.target) { stopBot("Target Profit Reached"); return; }
    if(totalProfit <= -settings.stopL) { stopBot("Stop Loss Reached"); return; }

    tickHistory.push(currentPrice);
    if(tickHistory.length > 50) tickHistory.shift(); // Mila data betsaka kokoa
    if(tickHistory.length < 20) return; // Miandry data ampy

    // Calculs Techniques
    const rsi = calculateRSI(tickHistory, 14);
    const sma = calculateSMA(tickHistory, 20);

    // Update UI Infos
    document.getElementById('decision-overlay').innerText = `RSI: ${rsi.toFixed(1)} | SMA: ${sma.toFixed(2)}`;

    // Raha efa misy stratégie mandeha tsara (WIN), dia io ihany jerena
    if (activeStrategy && lastTradeStatus === 'WIN') {
        const signal = STRATEGY_BANK[activeStrategy](tickHistory, rsi, sma);
        if (signal) {
            addLog(`🔥 Keeping Best Strategy: ${activeStrategy}`);
            placeTrade(signal);
            return;
        }
    }

    // Raha vao manomboka, na vao avy RESY (LOSS), dia mitady vaovao (SCAN)
    if (lastTradeStatus !== 'WIN') {
        let bestSignal = null;
        let bestStratName = null;

        // Loop through all 10 strategies
        for (const [name, logicFunc] of Object.entries(STRATEGY_BANK)) {
            const signal = logicFunc(tickHistory, rsi, sma);
            if (signal) {
                // Eto no misy ny safidy. 
                // Azo atao complex, fa eto dia raisintsika ny voalohany mety satria efa voasivana tsara.
                bestSignal = signal;
                bestStratName = name;
                break; // Hita ny lalana!
            }
        }

        if (bestSignal) {
            activeStrategy = bestStratName;
            document.getElementById('current-strategy-badge').innerText = activeStrategy;
            document.getElementById('ai-status').innerText = "⚡ AI: EXECUTION...";
            document.getElementById('ai-status').style.color = "#3fb950";
            placeTrade(bestSignal);
        } else {
            document.getElementById('ai-status').innerText = "👀 AI: Scanning (No Signal)";
            document.getElementById('ai-status').style.color = "#d29922";
        }
    }
}

function placeTrade(type) {
    // Verify Stake Limit (Safety)
    if(currentStake > 5) currentStake = 5; // Force Max $5
    
    addLog(`🤖 Signal: ${type} | Mise: $${currentStake}`);
    ws.send(JSON.stringify({
        buy: 1,
        price: currentStake,
        parameters: { 
            amount: currentStake, 
            basis: 'stake', 
            contract_type: type, 
            currency: 'USD', 
            duration: 5, 
            duration_unit: 't', 
            symbol: 'R_100' 
        }
    }));
}

// 8. RESULT & MARTINGALE LOGIC
async function processResult(contract) {
    const profit = parseFloat(contract.profit);
    totalProfit += profit;
    updateUIBalance();
    
    const isWin = profit >= 0;
    lastTradeStatus = isWin ? 'WIN' : 'LOSS';

    // UI Log Update
    const li = document.createElement('li');
    const badgeClass = isWin ? 'badge-win' : 'badge-loss';
    const sign = isWin ? '+' : '';
    li.className = isWin ? 'win' : 'loss';
    li.innerHTML = `
        <div class="history-info">
            <span class="history-strat">${activeStrategy || 'Unknown'}</span>
            <span class="history-amount">${sign}$${Math.abs(profit).toFixed(2)}</span>
        </div>
        <span class="badge ${badgeClass}">${isWin ? 'WIN' : 'LOSS'}</span>
    `;
    document.getElementById('history-list').prepend(li);
    document.getElementById('total-pl-display').innerText = totalProfit.toFixed(2);

    // AI DECISION APRES TRADE
    if (isWin) {
        document.getElementById('sound-win').play();
        addLog(`✅ WIN! Profit: $${profit}. Reset Stake.`);
        currentStake = settings.baseStake; // Reset Mise
        
        // Stop sy Fankalazana
        stopBot("WIN - Pause"); 
        const modal = document.getElementById('win-modal');
        document.getElementById('win-message').innerHTML = `Tombony azo: <b style="color:#3fb950">$${profit.toFixed(2)}</b>.<br>Mitazona stratégie: ${activeStrategy}`;
        modal.classList.remove('hidden');
    } else {
        document.getElementById('sound-loss').play();
        addLog(`❌ LOSS. Martingale x2 applied.`);
        currentStake = currentStake * martingaleMultiplier; // MARTINGALE x2
        activeStrategy = null; // Reset Strategie mba hitady vaovao
    }
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
                label: 'Market Price', data: Array(30).fill(null),
                borderColor: '#58a6ff', borderWidth: 2, tension: 0.3, pointRadius: 0
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