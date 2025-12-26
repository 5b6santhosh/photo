const express = require('express');
const Report = require('../models/Report');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/',
    // auth, 
    async (req, res) => {
        const { fileId, reason } = req.body;
        const userId = req.user.id;

        const exists = await Report.findOne({
            fileId,
            reportedBy: userId,
        });

        if (exists) {
            return res
                .status(400)
                .json({ message: 'You already reported this photo' });
        }

        await Report.create({
            fileId,
            reportedBy: userId,
            reason,
        });

        res.json({ success: true, message: 'Report submitted' });
    });

module.exports = router;
