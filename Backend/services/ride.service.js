const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Captains are offered ride requests whose pickup is within this many km of them.
const MATCH_RADIUS_KM = 5;
module.exports.MATCH_RADIUS_KM = MATCH_RADIUS_KM;

// Ride vehicle types are named differently from captain vehicle types.
const CAPTAIN_VEHICLE = {
    car: 'car',
    auto: 'auto',
    moto: 'motorcycle'
};
module.exports.CAPTAIN_VEHICLE = CAPTAIN_VEHICLE;

async function getFare(pickup, destination) {

    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);

    return calculateFare(distanceTime);
}

function calculateFare(distanceTime) {
    const baseFare = {
        auto: 30,
        car: 50,
        moto: 20
    };

    const perKmRate = {
        auto: 10,
        car: 15,
        moto: 8
    };

    const perMinuteRate = {
        auto: 2,
        car: 3,
        moto: 1.5
    };



    const fare = {
        auto: Math.round(baseFare.auto + ((distanceTime.distance.value / 1000) * perKmRate.auto) + ((distanceTime.duration.value / 60) * perMinuteRate.auto)),
        car: Math.round(baseFare.car + ((distanceTime.distance.value / 1000) * perKmRate.car) + ((distanceTime.duration.value / 60) * perMinuteRate.car)),
        moto: Math.round(baseFare.moto + ((distanceTime.distance.value / 1000) * perKmRate.moto) + ((distanceTime.duration.value / 60) * perMinuteRate.moto))
    };

    return fare;


}

module.exports.getFare = getFare;


function getOtp(num) {
    function generateOtp(num) {
        const otp = crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
        return otp;
    }
    return generateOtp(num);
}


module.exports.createRide = async ({
    user, pickup, destination, vehicleType
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const fare = calculateFare(distanceTime);

    const ride = rideModel.create({
        user,
        pickup,
        destination,
        pickupLocation: distanceTime.from,
        vehicleType,
        distance: distanceTime.distance.value,
        duration: distanceTime.duration.value,
        otp: getOtp(6),
        fare: fare[ vehicleType ]
    })

    return ride;
}

// Waiting ride requests near a captain that match their vehicle, nearest first.
module.exports.getNearbyRides = async (captain) => {
    if (!captain.location?.ltd || !captain.location?.lng) {
        return [];
    }

    const vehicleTypes = Object.keys(CAPTAIN_VEHICLE).filter(type => CAPTAIN_VEHICLE[ type ] === captain.vehicle.vehicleType);

    const rides = await rideModel.find({
        status: 'pending',
        vehicleType: { $in: vehicleTypes },
        'pickupLocation.ltd': { $ne: null }
    }).populate('user').sort({ createdAt: -1 });

    return rides
        .map(ride => ({ ...ride.toObject(), distanceKm: mapService.distanceKm(captain.location, ride.pickupLocation) }))
        .filter(ride => ride.distanceKm <= MATCH_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm);
}

module.exports.confirmRide = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    // Only a waiting ride can be accepted, so two captains can't both take it.
    const accepted = await rideModel.findOneAndUpdate({
        _id: rideId,
        status: 'pending'
    }, {
        status: 'accepted',
        captain: captain._id
    })

    if (!accepted) {
        throw new Error('This ride is no longer available');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    return ride;

}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'accepted') {
        throw new Error('Ride not accepted');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'ongoing'
    })

    return ride;
}

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'ongoing') {
        throw new Error('Ride not ongoing');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'completed',
        completedAt: new Date()
    })

    return ride;
}

