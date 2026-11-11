import React from 'react'

// Waiting ride requests near an online captain. Tapping one opens it so the captain can accept.
const NearbyRides = ({ rides, onSelect }) => {
    return (
        <div className='mt-6'>
            <h4 className='text-lg font-semibold mb-2'>Rides near you</h4>
            {rides.length === 0 && (
                <p className='text-sm text-gray-600'>No ride requests nearby right now. New ones will pop up here.</p>
            )}
            {rides.map(ride => (
                <div
                    key={ride._id}
                    onClick={() => onSelect(ride)}
                    className='flex items-center justify-between gap-3 p-3 mb-2 border-2 border-gray-100 active:border-black rounded-xl cursor-pointer'>
                    <div className='min-w-0'>
                        <h5 className='font-medium truncate'>{ride.pickup?.split(',')[ 0 ]}</h5>
                        <p className='text-sm text-gray-600 truncate'>to {ride.destination?.split(',')[ 0 ]}</p>
                    </div>
                    <div className='text-right shrink-0'>
                        <h5 className='font-semibold'>₹{ride.fare}</h5>
                        <p className='text-sm text-gray-600'>{ride.distanceKm != null ? `${ride.distanceKm.toFixed(1)} km away` : ''}</p>
                    </div>
                </div>
            ))}
        </div>
    )
}

export default NearbyRides
