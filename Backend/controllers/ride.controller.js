const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const { sendMessageToSocketId } = require('../socket');
const rideModel = require('../models/ride.model');


module.exports.createRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { pickup, destination, vehicleType } = req.body;

    let ride;
    try {
        ride = await rideService.createRide({ user: req.user._id, pickup, destination, vehicleType });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: err.message });
    }

    res.status(201).json(ride);

    try {
        // Offer the ride to online captains near the pickup who drive this kind of vehicle.
        const { ltd, lng } = ride.pickupLocation;
        const captainsInRadius = await mapService.getCaptainsInTheRadius(
            ltd, lng, rideService.MATCH_RADIUS_KM, rideService.CAPTAIN_VEHICLE[ vehicleType ]
        );

        const rideWithUser = await rideModel.findOne({ _id: ride._id }).populate('user');

        captainsInRadius.forEach(({ captain, distanceKm }) => {
            sendMessageToSocketId(captain.socketId, {
                event: 'new-ride',
                data: { ...rideWithUser.toObject(), distanceKm }
            })
        })
    } catch (err) {
        console.log(err);
    }
};

module.exports.getNearbyRides = async (req, res) => {
    try {
        const rides = await rideService.getNearbyRides(req.captain);
        return res.status(200).json(rides);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.getFare = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { pickup, destination } = req.query;

    try {
        const fare = await rideService.getFare(pickup, destination);
        return res.status(200).json(fare);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.confirmRide({ rideId, captain: req.captain });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-confirmed',
            data: ride
        })

        // Let other online captains drop it from their list.
        const otherCaptains = await mapService.getCaptainsInTheRadius(
            ride.pickupLocation?.ltd, ride.pickupLocation?.lng, rideService.MATCH_RADIUS_KM
        );
        otherCaptains
            .filter(({ captain }) => !captain._id.equals(req.captain._id))
            .forEach(({ captain }) => sendMessageToSocketId(captain.socketId, { event: 'ride-taken', data: { rideId: ride._id } }));

        return res.status(200).json(ride);
    } catch (err) {

        console.log(err);
        return res.status(409).json({ message: err.message });
    }
}

module.exports.startRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, otp } = req.query;

    try {
        const ride = await rideService.startRide({ rideId, otp, captain: req.captain });

        console.log(ride);

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-started',
            data: ride
        })

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.endRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.endRide({ rideId, captain: req.captain });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-ended',
            data: ride
        })



        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}