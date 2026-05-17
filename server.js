const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const ping = require('ping');
const path = require('path');
const si = require('systeminformation');
const find = require('local-devices');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- KONFIGURASI LOGIN ---
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'alipradana';

// SETTING CACHE & SESSION (WAJIB PALING ATAS)
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

app.use(session({
    secret: 'aly-pradana-netmonly-2026', 
    resave: false,
    saveUninitialized: false, 
    cookie: { maxAge: 3600000 } 
}));

app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// =========================================================
// DAFTAR PERANGKAT (MAPPING MAC ADDRESS)
// =========================================================
const daftarManual = {
    '02:7a:36:00:94:5b': 'Narzo 50i',
    '50:29:f5:8d:33:05': 'Oppo A3S',
    '5c:92:5e:a6:3b:bd': 'Lenovo Thinkpad',
    'c6:69:90:e7:3b:f0': 'Vivo Y12',

};

// MIDDLEWARE AUTH (Pengecekan Login)
const auth = (req, res, next) => {
    if (req.session && req.session.isLoggedIn) {
        return next();
    }
    return res.redirect('/login');
};

// ROUTES
app.get('/login', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/');
    res.send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <script src="https://cdn.tailwindcss.com"></script>
            <title>NetMonly Login</title>
        </head>
        <body class="bg-gray-950 flex items-center justify-center h-screen text-gray-100">
            <form action="/login" method="POST" class="bg-gray-900 p-8 rounded-3xl border border-gray-800 shadow-2xl w-96">
                <div class="text-center mb-10">
                    <div class="flex justify-center mb-4">
                        <img src="assets/logo.png" alt="NetMonly Logo" class="w-20 h-20 object-contain drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                    </div>
                    <h2 class="text-3xl font-black text-blue-500 tracking-tighter uppercase font-sans">NETMONLY</h2>
                    <p class="text-gray-500 text-[10px] uppercase tracking-[0.3em] mt-1 font-bold">Network Intelligence System</p>
                </div>
                <div class="mb-5">
                    <label class="block text-[10px] mb-2 text-gray-500 font-bold uppercase tracking-wider">Username</label>
                    <input type="text" name="username" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl focus:border-blue-500 outline-none transition text-sm" placeholder="Username..." required>
                </div>
                <div class="mb-8">
                    <label class="block text-[10px] mb-2 text-gray-500 font-bold uppercase tracking-wider">Password</label>
                    <input type="password" name="password" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl focus:border-blue-500 outline-none transition text-sm" placeholder="••••••••" required>
                </div>
                <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-95 uppercase tracking-widest text-sm">
                    Authenticate
                </button>
                <p class="text-center text-[9px] text-gray-600 mt-6 uppercase tracking-widest italic font-mono">v1.0 Secure Access By Alipradana</p>
            </form>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isLoggedIn = true;
        req.session.save(() => { 
            res.redirect('/');
        });
    } else {
        res.send("<script>alert('Akses Ditolak!'); window.location='/login';</script>");
    }
});

app.get('/', auth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.clearCookie('connect.sid'); 
        res.redirect('/login');
    });
});

// --- LOGIKA MONITORING JARINGAN ---
const TARGET_IP = '192.168.1.1'; 
let deviceList = [];

async function scanDevices() {
    try {
        console.log("[Scanner] Memindai jaringan lokal...");
        const devices = await find();
        deviceList = devices.map(d => {
            let displayName = daftarManual[d.mac] || d.name;
            if (!displayName || displayName === '?' || displayName.toLowerCase().includes('unknown')) {
                displayName = '?'; 
            }
            return { name: displayName, ip: d.ip, mac: d.mac };
        });
        console.table(deviceList); 
    } catch (err) { console.error("Scan Error:", err); }
}

// Jalankan scan pertama kali dan setiap 15 detik
scanDevices();
setInterval(scanDevices, 15000);

// Update Data ke Frontend setiap 2 detik
setInterval(async () => {
    try {
        let pingRes = await ping.promise.probe(TARGET_IP);
        const networkInfs = await si.networkInterfaceDefault();
        const netStats = await si.networkStats(networkInfs);
        
        let downloadMbps = 0;
        if (netStats && netStats.length > 0) {
            // Perhitungan Throughput dalam Mbps
            downloadMbps = (netStats[0].rx_sec / 1024 / 1024 * 8).toFixed(1);
        }

        // Ambil packet loss. Jika tidak terdeteksi (alive=false), set ke 100
        let pLoss = 0;
        if (!pingRes.alive) {
            pLoss = 100;
        } else {
            pLoss = pingRes.packetLoss !== 'unknown' ? parseFloat(pingRes.packetLoss).toFixed(0) : 0;
        }

        io.emit('update_data', {
            latency: pingRes.time !== 'unknown' ? parseFloat(pingRes.time) : 0,
            status: pingRes.alive ? 'Online' : 'Offline',
            bandwidth: downloadMbps,
            activeDevices: deviceList.length,
            devices: deviceList,
            packetLoss: pLoss,
        });
    } catch (err) { console.error("Monitor Error:", err); }
}, 2000);

io.on('connection', (socket) => {
    socket.on('manual_scan', () => {
        console.log("[User] Meminta scan manual...");
        scanDevices();
    });
});

server.listen(3000, () => {
    console.log('NETMONLY Aktif: http://localhost:3000');
});