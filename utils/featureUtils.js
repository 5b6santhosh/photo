function safeDivide(a, b) {
    if (!b || b === 0) return 0;
    return Number((a / b).toFixed(4));
}

module.exports = { safeDivide };
