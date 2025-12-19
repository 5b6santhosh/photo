// module.exports = function adminOnly(req, res, next) {
//     if (req.user.role !== 'admin') {
//         return res.status(403).json({ message: 'Admin access only' });
//     }
//     next();
// };


const adminOnly = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access only' });
    }
    next();
};

module.exports = adminOnly;