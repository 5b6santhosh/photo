const sharp = require('sharp');

/**
 * Simple perceptual hash (pHash-like)
 */
async function generateImageHash(imagePath) {
    const buffer = await sharp(imagePath)
        .resize(32, 32)
        .greyscale()
        .raw()
        .toBuffer();

    const avg =
        buffer.reduce((sum, v) => sum + v, 0) / buffer.length;

    return [...buffer]
        .map(v => (v > avg ? '1' : '0'))
        .join('');
}

/**
 * Hamming distance
 */
function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) dist++;
    }
    return dist;
}

module.exports = {
    generateImageHash,
    hammingDistance
};
