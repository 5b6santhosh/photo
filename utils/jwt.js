// const jwt = require('jsonwebtoken');

// const JWT_SECRET = process.env.JWT_SECRET || 'mySuperSecretLongRandomString123!@#4567890abcdefghijklmnopqrstuvwxyz';

// exports.generateToken = (user) => {
//     return jwt.sign(
//         {
//             id: user._id,
//             role: user.role || 'user',
//         },
//         JWT_SECRET,
//         { expiresIn: '30d' }
//     );
// };

// exports.verifyToken = (req, res, next) => {
//     const authHeader = req.headers.authorization;

//     if (!authHeader)
//         return res.status(401).json({ message: 'No token provided' });

//     const token = authHeader.split(' ')[1];

//     try {
//         const decoded = jwt.verify(token, JWT_SECRET);
//         req.user = decoded; // 👈 attach user to request
//         next();
//     } catch (err) {
//         res.status(401).json({ message: 'Invalid token' });
//     }
// };
