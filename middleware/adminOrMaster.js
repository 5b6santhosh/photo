module.exports = function adminOrMaster(req, res, next) {
    const { role, badgeTier } = req.user;

    if (role === 'admin' || badgeTier === 'master') {
        return next();
    }

    return res.status(403).json({
        message: 'Only Admin or Master curators can perform this action'
    });
};
