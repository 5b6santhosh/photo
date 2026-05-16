// utils/streakUtils.js

/**
 * Calculate and update user streak based on login activity
 * @param {Object} user - Mongoose User document (with write access)
 * @returns {Promise<Object>} Updated streak info
 */
async function updateStreak(user) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let lastLogin = user.login_date ? new Date(user.login_date) : null;
    let lastLoginDate = lastLogin
        ? new Date(lastLogin.getFullYear(), lastLogin.getMonth(), lastLogin.getDate())
        : null;

    let streakDays = user.streakDays || 0;

    // Case 1: First ever login
    if (!lastLoginDate) {
        streakDays = 1;
    }
    // Case 2: Already logged in today - no change
    else if (lastLoginDate.getTime() === today.getTime()) {
        // Streak stays the same, just update login_date timestamp
    }
    // Case 3: Last login was yesterday - increment streak
    else {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastLoginDate.getTime() === yesterday.getTime()) {
            streakDays += 1;
        }
        // Case 4: Gap of 2+ days - reset streak
        else {
            streakDays = 1;
        }
    }

    // Update user fields
    user.login_date = now;
    user.streakDays = streakDays;

    await user.save();

    return {
        streakDays,
        lastLogin: now,
        isToday: lastLoginDate?.getTime() === today.getTime()
    };
}

/**
 * Get current streak without updating (for read-only operations)
 * @param {Object} user - User document
 * @returns {number} Current streak count
 */
function getCurrentStreak(user) {
    return user.streakDays || 0;
}

module.exports = {
    updateStreak,
    getCurrentStreak
};