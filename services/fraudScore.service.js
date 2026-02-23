function calculateFraudScore({ mlLog, judgeDecision }) {
    let score = 0;
    const reasons = [];

    // Duplicate risk
    // if (mlLog.features?.perceptualHash) score += 10;
    if (mlLog.scores.finalScore === 0 && mlLog.verdict === 'rejected') {
        score += 20;
        reasons.push('Duplicate submission detected');
    }

    // Low AI confidence
    if (mlLog.scores.finalScore < 75) {
        score += 20;
        reasons.push('Low AI confidence');
    }

    // High skin exposure
    if (mlLog.features.skinExposureRatio > 45) {
        score += 20;
        reasons.push('High skin exposure');
    }

    // Judge override against AI
    if (judgeDecision?.overridesAI) {
        score += 30;
        reasons.push('Judge override against AI');
    }

    // Prior user fraud history (future)
    // score += userRiskScore * 10;

    return {
        fraudScore: score,
        reasons
    };
}

module.exports = { calculateFraudScore };
