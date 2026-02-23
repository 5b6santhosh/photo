// routes/admin/declareWinners.js
const Submission = require('../models/Submission'); // 

router.post('/declare', async (req, res) => {
    const { contestId, winners } = req.body; // winners = [{ entryId, position }]

    for (const w of winners) {
        // Map position to status
        let status = 'submitted';
        if (w.position === 1) status = 'winner';
        else if (w.position <= 3) status = 'shortlisted';

        await Submission.findByIdAndUpdate(w.entryId, { status });
    }

    res.json({ success: true });
});

router.get('/my/:contestId', async (req, res) => {
    const { contestId } = req.params;
    const userId = req.user.id;

    const submission = await Submission.findOne({ contestId, userId })
        .populate('fileId');

    res.json(submission);
});