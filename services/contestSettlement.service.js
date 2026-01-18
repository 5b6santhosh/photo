const Contest = require('../models/Contest');
const JudgeDecision = require('../models/JudgeDecision');
const MLFeatureLog = require('../models/MLFeatureLog');
const { calculateFraudScore } = require('./fraudScore.service');
const WalletService = require('./wallet.service');

async function finalizeContestAndPayout(contestId) {

    const contest = await Contest.findById(contestId);
    if (!contest || contest.settlement.finalized) return;

    const winners = await JudgeDecision.find({
        contestId,
        finalDecision: 'winner'
    });

    if (winners.length === 0) {
        throw new Error('No winners selected');
    }

    contest.settlement.finalized = true;
    contest.settlement.finalizedAt = new Date();

    for (const winner of winners) {
        const mlLog = await MLFeatureLog.findOne({
            contestId,
            entryId: winner.entryId
        });

        const { fraudScore, reasons } =
            calculateFraudScore({ mlLog, judgeDecision: winner });

        // 🚨 HOLD
        if (fraudScore >= 50) {
            contest.settlement.payoutStatus = 'on_hold';
            contest.settlement.holdReason = reasons.join(', ');
            await contest.save();
            return;
        }
    }

    // 💰 PAYOUT
    contest.settlement.payoutStatus = 'processing';
    await contest.save();

    for (const winner of winners) {
        await WalletService.credit({
            userId: winner.userId,
            amount: contest.prizeAmount / winners.length,
            reason: `Contest win: ${contest.title}`,
            contestId
        });
    }

    contest.settlement.payoutStatus = 'paid';
    await contest.save();
}

module.exports = { finalizeContestAndPayout };
