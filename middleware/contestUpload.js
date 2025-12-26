// middleware/contestUpload.js
const Contest = require('../models/Contest');
const Submission = require('../models/Submission');

const contestUpload = async (req, res, next) => {
    try {
        const contestId = req.params.id;
        const userId = req.user?.id || req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ message: 'User authentication required' });
        }

        const contest = await Contest.findById(contestId);

        if (!contest) {
            return res.status(404).json({ message: 'Contest not found' });
        }

        // Check if contest is open for submissions
        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({
                message: 'Contest is not open for submissions',
                contestStatus: contest.contestStatus,
                startDate: contest.startDate,
                endDate: contest.endDate
            });
        }

        // Check submission count against limit
        const userSubmissionCount = await Submission.countDocuments({
            userId,
            contestId
        });

        if (userSubmissionCount >= contest.maxSubmissionsPerUser) {
            return res.status(400).json({
                message: `You have reached the maximum submissions limit (${contest.maxSubmissionsPerUser})`,
                currentSubmissions: userSubmissionCount,
                maxAllowed: contest.maxSubmissionsPerUser
            });
        }


        // Store contest info for file upload validation
        req.contest = contest;
        req.userId = userId;

        next();
    } catch (error) {
        console.error('Contest upload middleware error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = contestUpload;