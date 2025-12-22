// const jwt = require('jsonwebtoken');

// module.exports = function auth(req, res, next) {
//     try {
//         const header = req.headers.authorization;

//         if (!header || !header.startsWith('Bearer ')) {
//             return res.status(401).json({ message: 'No token provided' });
//         }

//         const token = header.split(' ')[1];
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);

//         req.user = {
//             id: decoded.id,
//             role: decoded.role, // user | admin
//         };

//         next();
//     } catch (err) {
//         return res.status(401).json({ message: 'Invalid or expired token' });
//     }
// };

// const jwt = require('jsonwebtoken');
// const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key';

// // 1. Main Auth Middleware
// const auth = (req, res, next) => {
//     try {
//         const header = req.headers.authorization;
//         if (!header || !header.startsWith('Bearer ')) {
//             return res.status(401).json({ message: 'No token provided' });
//         }

//         const token = header.split(' ')[1];
//         const decoded = jwt.verify(token, JWT_SECRET);

//         req.user = {
//             id: decoded.id,
//             role: decoded.role,
//         };
//         next();
//     } catch (err) {
//         return res.status(401).json({ message: 'Invalid or expired token' });
//     }
// };

// module.exports = auth;

// const jwt = require('jsonwebtoken');

// const JWT_SECRET = process.env.JWT_SECRET || 'mySuperSecretLongRandomString123!@#4567890abcdefghijklmnopqrstuvwxyz';

// const verifyToken = (req, res, next) => {
//     const authHeader = req.headers.authorization;

//     if (!authHeader || !authHeader.startsWith('Bearer ')) {
//         return res.status(401).json({ message: 'No token provided' });
//     }

//     const token = authHeader.split(' ')[1];

//     try {
//         const decoded = jwt.verify(token, JWT_SECRET);
//         req.user = decoded; // contains id, email, username, etc.
//         next();
//     } catch (err) {
//         return res.status(401).json({ message: 'Invalid or expired token' });
//     }
// };

// module.exports = verifyToken;
