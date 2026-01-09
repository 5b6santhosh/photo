
// const currencyMap = {
//     // India (Primary market)
//     'IN': {
//         currency: 'INR',
//         multiplier: 1.0,        // No conversion needed
//         symbol: '₹',
//         razorpaySupported: true
//     },

//     // United States
//     'US': {
//         currency: 'USD',
//         multiplier: 1.03,       // Razorpay FX + processing fee buffer (3%)
//         symbol: '$',
//         razorpaySupported: true
//     },

//     // United Arab Emirates
//     'AE': {
//         currency: 'AED',
//         multiplier: 1.04,       // 4% buffer for FX volatility
//         symbol: 'د.إ',
//         razorpaySupported: true
//     },

//     // United Kingdom
//     'GB': {
//         currency: 'GBP',
//         multiplier: 1.03,
//         symbol: '£',
//         razorpaySupported: true
//     },

//     // Australia
//     'AU': {
//         currency: 'AUD',
//         multiplier: 1.04,
//         symbol: 'A$',
//         razorpaySupported: true
//     },

//     // Canada
//     'CA': {
//         currency: 'CAD',
//         multiplier: 1.04,
//         symbol: 'C$',
//         razorpaySupported: true
//     },

//     // Singapore
//     'SG': {
//         currency: 'SGD',
//         multiplier: 1.03,
//         symbol: 'S$',
//         razorpaySupported: true
//     },

//     // Europe (Eurozone)
//     'DE': { currency: 'EUR', multiplier: 1.03, symbol: '€', razorpaySupported: true },
//     'FR': { currency: 'EUR', multiplier: 1.03, symbol: '€', razorpaySupported: true },
//     'IT': { currency: 'EUR', multiplier: 1.03, symbol: '€', razorpaySupported: true },
//     'ES': { currency: 'EUR', multiplier: 1.03, symbol: '€', razorpaySupported: true },
//     'NL': { currency: 'EUR', multiplier: 1.03, symbol: '€', razorpaySupported: true },

//     // Middle East
//     'SA': { currency: 'SAR', multiplier: 1.04, symbol: 'ر.س', razorpaySupported: true },
//     'QA': { currency: 'QAR', multiplier: 1.04, symbol: 'ر.ق', razorpaySupported: true },

//     // Southeast Asia
//     'MY': { currency: 'MYR', multiplier: 1.04, symbol: 'RM', razorpaySupported: true },
//     'ID': { currency: 'IDR', multiplier: 1.05, symbol: 'Rp', razorpaySupported: false }, // Note: Razorpay may not support IDR

//     // Fallback for unsupported countries
//     'DEFAULT': {
//         currency: 'INR',
//         multiplier: 1.0,
//         symbol: '₹',
//         razorpaySupported: true
//     }
// };

// // Razorpay officially supported currencies (as of 2024)
// const RAZORPAY_SUPPORTED_CURRENCIES = [
//     'INR', 'USD', 'AED', 'AUD', 'BHD', 'CAD', 'CHF', 'EUR', 'GBP',
//     'HKD', 'JPY', 'KWD', 'LKR', 'MAD', 'MYR', 'OMR', 'QAR', 'SAR',
//     'SGD', 'THB', 'TRY', 'ZAR'
// ];

// // Helper function to validate currency
// function getRegion(countryCode) {
//     const region = currencyMap[countryCode] || currencyMap['IN'] || currencyMap['DEFAULT'];

//     // Validate Razorpay support
//     if (!RAZORPAY_SUPPORTED_CURRENCIES.includes(region.currency)) {
//         console.warn(` Razorpay may not support ${region.currency} for ${countryCode}. Falling back to INR.`);
//         return currencyMap['IN'];
//     }

//     return region;
// }

// export {
//     currencyMap,
//     RAZORPAY_SUPPORTED_CURRENCIES,
//     getRegion
// };


// config/currencyMap.js
// Full list of Razorpay supported currencies as of latest available data (2026).
// Razorpay supports 130+ currencies for international payments.
const RAZORPAY_SUPPORTED_CURRENCIES = [
    'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
    'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
    'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
    'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
    'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
    'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS',
    'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR',
    'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD',
    'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU',
    'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK',
    'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
    'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK',
    'SGD', 'SHP', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SZL', 'THB',
    'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TVD', 'TWD', 'TZS', 'UAH',
    'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD',
    'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL'
];

const currencyMap = {
    'DEFAULT': { currency: 'INR', multiplier: 1, symbol: '₹', razorpaySupported: true },
    'IN': { currency: 'INR', multiplier: 1, symbol: '₹', razorpaySupported: true },

    // North America
    'US': { currency: 'USD', multiplier: 1, symbol: '$', razorpaySupported: true },
    'CA': { currency: 'CAD', multiplier: 1, symbol: 'CA$', razorpaySupported: true },
    'MX': { currency: 'MXN', multiplier: 1, symbol: 'MX$', razorpaySupported: true },

    // Europe
    'EU': { currency: 'EUR', multiplier: 1, symbol: '€', razorpaySupported: true },
    'GB': { currency: 'GBP', multiplier: 1, symbol: '£', razorpaySupported: true },
    'SE': { currency: 'SEK', multiplier: 1, symbol: 'kr', razorpaySupported: true },
    'DK': { currency: 'DKK', multiplier: 1, symbol: 'kr', razorpaySupported: true },
    'NO': { currency: 'NOK', multiplier: 1, symbol: 'kr', razorpaySupported: true },
    'CH': { currency: 'CHF', multiplier: 1, symbol: 'CHF', razorpaySupported: true },
    'PL': { currency: 'PLN', multiplier: 1, symbol: 'zł', razorpaySupported: true },

    // Asia-Pacific
    'SG': { currency: 'SGD', multiplier: 1, symbol: 'S$', razorpaySupported: true },
    'AU': { currency: 'AUD', multiplier: 1, symbol: 'A$', razorpaySupported: true },
    'NZ': { currency: 'NZD', multiplier: 1, symbol: 'NZ$', razorpaySupported: true },
    'JP': { currency: 'JPY', multiplier: 1, symbol: '¥', razorpaySupported: true },
    'CN': { currency: 'CNY', multiplier: 1, symbol: '¥', razorpaySupported: true },
    'HK': { currency: 'HKD', multiplier: 1, symbol: 'HK$', razorpaySupported: true },
    'TH': { currency: 'THB', multiplier: 1, symbol: '฿', razorpaySupported: true },
    'MY': { currency: 'MYR', multiplier: 1, symbol: 'RM', razorpaySupported: true },
    'ID': { currency: 'IDR', multiplier: 1.05, symbol: 'Rp', razorpaySupported: true },
    'PH': { currency: 'PHP', multiplier: 1, symbol: '₱', razorpaySupported: true },

    // Middle East
    'AE': { currency: 'AED', multiplier: 1, symbol: 'د.إ', razorpaySupported: true },
    'SA': { currency: 'SAR', multiplier: 1, symbol: 'ر.س', razorpaySupported: true },
    'QA': { currency: 'QAR', multiplier: 1, symbol: 'ر.ق', razorpaySupported: true },

    // South America
    'BR': { currency: 'BRL', multiplier: 1, symbol: 'R$', razorpaySupported: true },
    'AR': { currency: 'ARS', multiplier: 1, symbol: '$', razorpaySupported: true },

    // Africa
    'ZA': { currency: 'ZAR', multiplier: 1, symbol: 'R', razorpaySupported: true },
    'NG': { currency: 'NGN', multiplier: 1, symbol: '₦', razorpaySupported: true },

    // Other major markets
    'KR': { currency: 'KRW', multiplier: 1, symbol: '₩', razorpaySupported: true },
    'TR': { currency: 'TRY', multiplier: 1, symbol: '₺', razorpaySupported: true },
    'VN': { currency: 'VND', multiplier: 1, symbol: '₫', razorpaySupported: true },
};

function getRegion(countryCode) {
    let region = currencyMap[countryCode] || currencyMap['IN'] || currencyMap['DEFAULT'];

    if (!RAZORPAY_SUPPORTED_CURRENCIES.includes(region.currency)) {
        console.warn(`Unsupported currency ${region.currency} for ${countryCode}. Falling back to INR.`);
        region = currencyMap['IN'];
    }
    return region;
}

module.exports = { currencyMap, RAZORPAY_SUPPORTED_CURRENCIES, getRegion };
