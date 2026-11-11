
import React, { useContext } from 'react'
import { CaptainDataContext } from '../context/CapatainContext'
import Avatar from './Avatar'

const CaptainDetails = ({ stats, online, onToggleOnline }) => {

    const { captain } = useContext(CaptainDataContext)

    return (
        <div>
            <div className='flex items-center justify-between'>
                <div className='flex items-center justify-start gap-3'>
                    <Avatar firstname={captain.fullname.firstname} lastname={captain.fullname.lastname} size='h-10 w-10' />
                    <div>
                        <h4 className='text-lg font-medium capitalize'>{captain.fullname.firstname + " " + (captain.fullname.lastname || '')}</h4>
                        <p className='text-sm text-gray-600 capitalize'>{captain.vehicle.color} {captain.vehicle.vehicleType} · {captain.vehicle.plate}</p>
                    </div>
                </div>
                <div className='text-right'>
                    <h4 className='text-xl font-semibold'>₹{stats ? stats.earningsToday : '–'}</h4>
                    <p className='text-sm text-gray-600'>Earned today</p>
                </div>
            </div>

            <button
                onClick={onToggleOnline}
                className={`w-full mt-5 p-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${online ? 'bg-gray-200 text-gray-800' : 'bg-green-600 text-white'}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-white'}`}></span>
                {online ? "You're online · Go offline" : 'Go online'}
            </button>

            <div className='flex p-3 mt-5 bg-gray-100 rounded-xl justify-around gap-5 items-start'>
                <div className='text-center'>
                    <i className="text-3xl mb-2 font-thin ri-timer-2-line"></i>
                    <h5 className='text-lg font-medium'>{stats ? stats.hoursOnlineToday : '–'}</h5>
                    <p className='text-sm text-gray-600'>Hours online today</p>
                </div>
                <div className='text-center'>
                    <i className="text-3xl mb-2 font-thin ri-steering-2-line"></i>
                    <h5 className='text-lg font-medium'>{stats ? stats.ridesToday : '–'}</h5>
                    <p className='text-sm text-gray-600'>Rides today</p>
                </div>
                <div className='text-center'>
                    <i className="text-3xl mb-2 font-thin ri-booklet-line"></i>
                    <h5 className='text-lg font-medium'>{stats ? stats.totalRides : '–'}</h5>
                    <p className='text-sm text-gray-600'>Total rides</p>
                </div>
            </div>
        </div>
    )
}

export default CaptainDetails
