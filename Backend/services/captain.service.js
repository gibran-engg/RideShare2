const captainModel = require('../models/captain.model');
const rideModel = require('../models/ride.model');

function today() {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

// Milliseconds online today, including the current session.
function onlineMsToday(captain) {
    let ms = captain.onlineDay === today() ? captain.onlineMsToday || 0 : 0;
    if (captain.status === 'active' && captain.onlineSince) {
        ms += Date.now() - Math.max(captain.onlineSince.getTime(), startOfToday().getTime());
    }
    return ms;
}

module.exports.setOnline = async (captain, online) => {
    const update = {};

    if (captain.onlineDay !== today()) {
        update.onlineDay = today();
        update.onlineMsToday = 0;
    }

    if (online && captain.status !== 'active') {
        update.status = 'active';
        update.onlineSince = new Date();
    } else if (!online && captain.status === 'active') {
        update.status = 'inactive';
        update.onlineMsToday = onlineMsToday(captain);
        update.onlineSince = null;
    }

    return captainModel.findByIdAndUpdate(captain._id, update, { new: true });
}

module.exports.getStats = async (captain) => {
    const [ todayRides, allRides ] = await Promise.all([
        rideModel.find({ captain: captain._id, status: 'completed', completedAt: { $gte: startOfToday() } }),
        rideModel.countDocuments({ captain: captain._id, status: 'completed' })
    ]);

    return {
        earningsToday: todayRides.reduce((sum, ride) => sum + ride.fare, 0),
        ridesToday: todayRides.length,
        hoursOnlineToday: Math.round(onlineMsToday(captain) / 360000) / 10, // one decimal
        totalRides: allRides,
        online: captain.status === 'active'
    };
}


module.exports.createCaptain = async ({
    firstname, lastname, email, password, color, plate, capacity, vehicleType
}) => {
    if (!firstname || !email || !password || !color || !plate || !capacity || !vehicleType) {
        throw new Error('All fields are required');
    }
    const captain = captainModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        vehicle: {
            color,
            plate,
            capacity,
            vehicleType
        }
    })

    return captain;
}