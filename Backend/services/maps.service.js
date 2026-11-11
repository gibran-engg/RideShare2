const axios = require('axios');
const crypto = require('crypto');
const captainModel = require('../models/captain.model');

// Ola Maps (https://maps.olakrutrim.com). The key is sent as the api_key query parameter.
const OLA_BASE_URL = 'https://api.olamaps.io';

async function olaGet(path, params) {
    const response = await axios.get(`${OLA_BASE_URL}${path}`, {
        params: { ...params, api_key: process.env.OLA_MAPS_API_KEY },
        headers: { 'X-Request-Id': crypto.randomUUID() }
    });
    return response.data;
}

// Ola returns distance/duration either as plain numbers or as { text, value }.
function toValue(field) {
    return typeof field === 'object' && field !== null ? field.value : field;
}

module.exports.getAddressCoordinate = async (address) => {
    try {
        const data = await olaGet('/places/v1/geocode', { address });
        const results = data.geocodingResults || data.results || [];

        if (results.length === 0) {
            throw new Error('Unable to fetch coordinates');
        }

        const location = results[ 0 ].geometry.location;
        return {
            ltd: location.lat,
            lng: location.lng
        };
    } catch (error) {
        console.error(error.response?.data || error.message);
        throw error;
    }
}

module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    try {
        // The distance matrix takes coordinates, so look up both addresses first.
        const [ from, to ] = await Promise.all([
            module.exports.getAddressCoordinate(origin),
            module.exports.getAddressCoordinate(destination)
        ]);

        const data = await olaGet('/routing/v1/distanceMatrix', {
            origins: `${from.ltd},${from.lng}`,
            destinations: `${to.ltd},${to.lng}`
        });

        const element = data.rows?.[ 0 ]?.elements?.[ 0 ];
        const distance = toValue(element?.distance);
        const duration = toValue(element?.duration);

        if (!element || (element.status && element.status !== 'OK') || distance == null || duration == null) {
            throw new Error('No routes found');
        }

        // Same shape as Google's response, so ride.service.js keeps working unchanged.
        return {
            distance: { text: `${(distance / 1000).toFixed(1)} km`, value: distance }, // meters
            duration: { text: `${Math.round(duration / 60)} mins`, value: duration }, // seconds
            status: 'OK',
            from,
            to
        };
    } catch (err) {
        console.error(err.response?.data || err.message);
        throw err;
    }
}

module.exports.getAutoCompleteSuggestions = async (input) => {
    if (!input) {
        throw new Error('query is required');
    }

    try {
        const data = await olaGet('/places/v1/autocomplete', { input });
        return (data.predictions || []).map(prediction => prediction.description).filter(value => value);
    } catch (err) {
        console.error(err.response?.data || err.message);
        throw err;
    }
}

module.exports.getAddressFromCoordinates = async (ltd, lng) => {
    try {
        const data = await olaGet('/places/v1/reverse-geocode', { latlng: `${ltd},${lng}` });
        const address = data.results?.[ 0 ]?.formatted_address;

        if (!address) {
            throw new Error('Unable to fetch address');
        }

        return address;
    } catch (err) {
        console.error(err.response?.data || err.message);
        throw err;
    }
}

// Straight-line distance in km between two { ltd, lng } points.
function distanceKm(a, b) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.ltd - a.ltd);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.ltd)) * Math.cos(toRad(b.ltd)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
}

module.exports.distanceKm = distanceKm;

// Online captains within `radius` km, nearest first. Pass a vehicleType to only match that vehicle.
module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, vehicleType) => {
    const filter = { status: 'active', 'location.ltd': { $ne: null }, 'location.lng': { $ne: null } };
    if (vehicleType) {
        filter[ 'vehicle.vehicleType' ] = vehicleType;
    }

    const captains = await captainModel.find(filter);

    return captains
        .map(captain => ({ captain, distanceKm: distanceKm({ ltd, lng }, captain.location) }))
        .filter(({ distanceKm }) => distanceKm <= radius)
        .sort((a, b) => a.distanceKm - b.distanceKm);
}
