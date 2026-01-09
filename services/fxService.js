// // services/fxService.js
// const axios = require('axios');

// async function getLiveFxRate(from, to) {
//     if (from === to) return 1;
//     try {
//         // Use a free API like ExchangeRate-API or similar
//         const response = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
//         return response.data.rates[to] || 1;
//     } catch (err) {
//         // Fallback rates if API fails
//         const fallbacks = { 'USD': 0.012, 'GBP': 0.0095 };
//         return fallbacks[to] || 1;
//     }
// }



// services/fxService.js
const axios = require('axios');
let fxCache = {
    updatedAt: null,
    rates: {}
};

async function refreshFxRates() {
    const res = await axios.get(
        // 'https://open.er-api.com/v6/latest/INR'
        'https://api.exchangerate-api.com/v4/latest/INR', {
        timeout: 5000
    }
    );
    fxCache = {
        updatedAt: Date.now(),
        rates: res.data.rates
    };
}

async function getFxRate(to) {
    if (!fxCache.updatedAt || Date.now() - fxCache.updatedAt > 6 * 60 * 60 * 1000) {
        await refreshFxRates();
    }
    const rate = fxCache.rates[to];
    if (!rate) throw new Error(`Rate not found for ${to}`);
    return rate;

}

module.exports = { getFxRate };
