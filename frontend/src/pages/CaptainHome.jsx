import React, { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CaptainDetails from '../components/CaptainDetails'
import RidePopUp from '../components/RidePopUp'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import ConfirmRidePopUp from '../components/ConfirmRidePopUp'
import { useEffect, useContext } from 'react'
import { SocketContext } from '../context/SocketContext'
import { CaptainDataContext } from '../context/CapatainContext'
import axios from 'axios'
import LiveTracking from '../components/LiveTracking'
import NearbyRides from '../components/NearbyRides'

const authHeaders = () => ({
    headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`
    }
})

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)

    const ridePopupPanelRef = useRef(null)
    const confirmRidePopupPanelRef = useRef(null)
    const [ ride, setRide ] = useState(null)
    const rideRef = useRef(ride)
    rideRef.current = ride

    const { socket } = useContext(SocketContext)
    const { captain, setCaptain } = useContext(CaptainDataContext)

    const [ online, setOnline ] = useState(captain.status === 'active')
    const [ stats, setStats ] = useState(null)
    const [ nearbyRides, setNearbyRides ] = useState([])
    const onlineRef = useRef(online)
    onlineRef.current = online

    const sendLocation = (location) => {
        socket.emit('update-location-captain', {
            userId: captain._id,
            location
        })
    }

    const loadStats = () => {
        axios.get(`${import.meta.env.VITE_BASE_URL}/captains/stats`, authHeaders())
            .then(response => setStats(response.data))
            .catch(() => { })
    }

    const loadNearbyRides = () => {
        axios.get(`${import.meta.env.VITE_BASE_URL}/rides/nearby`, authHeaders())
            .then(response => setNearbyRides(response.data))
            .catch(() => { })
    }

    useEffect(() => {
        socket.emit('join', {
            userId: captain._id,
            userType: 'captain'
        })

        // Share the captain's position every 10 seconds (the map also sends it whenever it moves).
        const updateLocation = () => {
            navigator.geolocation?.getCurrentPosition(position => {
                sendLocation({
                    ltd: position.coords.latitude,
                    lng: position.coords.longitude
                })
            })
        }

        const locationInterval = setInterval(updateLocation, 10000)
        updateLocation()
        loadStats()

        return () => clearInterval(locationInterval)
    }, [])

    // While online, keep the list of nearby requests fresh.
    useEffect(() => {
        if (!online) {
            setNearbyRides([])
            return
        }

        loadNearbyRides()
        const interval = setInterval(loadNearbyRides, 15000)
        return () => clearInterval(interval)
    }, [ online ])

    useEffect(() => {
        const onNewRide = (data) => {
            if (!onlineRef.current) return
            setNearbyRides(rides => [ data, ...rides.filter(r => r._id !== data._id) ])
            setRide(data)
            setRidePopupPanel(true)
        }
        const onRideTaken = ({ rideId }) => {
            setNearbyRides(rides => rides.filter(r => r._id !== rideId))
            if (rideRef.current?._id === rideId) setRidePopupPanel(false)
        }

        socket.on('new-ride', onNewRide)
        socket.on('ride-taken', onRideTaken)

        return () => {
            socket.off('new-ride', onNewRide)
            socket.off('ride-taken', onRideTaken)
        }
    }, [ socket ])

    async function toggleOnline() {
        try {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/status`, { online: !online }, authHeaders())
            setCaptain(response.data.captain)
            setOnline(response.data.captain.status === 'active')
            loadStats()
        } catch {
            alert("Couldn't change your status. Try again.")
        }
    }

    function openRide(selected) {
        setRide(selected)
        setRidePopupPanel(true)
    }

    async function confirmRide() {
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm`, {
                rideId: ride._id
            }, authHeaders())

            setRidePopupPanel(false)
            setConfirmRidePopupPanel(true)
        } catch (err) {
            setConfirmRidePopupPanel(false)
            setRidePopupPanel(false)
            setNearbyRides(rides => rides.filter(r => r._id !== ride._id))
            alert(err.response?.data?.message || "Couldn't accept this ride.")
        }
    }


    useGSAP(function () {
        if (ridePopupPanel) {
            gsap.to(ridePopupPanelRef.current, {
                y: 0, yPercent: 0
            })
        } else {
            gsap.to(ridePopupPanelRef.current, {
                y: 0, yPercent: 100
            })
        }
    }, [ ridePopupPanel ])

    useGSAP(function () {
        if (confirmRidePopupPanel) {
            gsap.to(confirmRidePopupPanelRef.current, {
                y: 0, yPercent: 0
            })
        } else {
            gsap.to(confirmRidePopupPanelRef.current, {
                y: 0, yPercent: 100
            })
        }
    }, [ confirmRidePopupPanel ])

    const rideMarkers = nearbyRides.map(nearby => ({
        id: nearby._id,
        ltd: nearby.pickupLocation?.ltd,
        lng: nearby.pickupLocation?.lng,
        kind: 'pickup',
        title: nearby.pickup
    }))

    return (
        <div className='h-screen flex flex-col'>
            <div className='fixed p-6 top-0 flex items-center justify-between w-screen z-10 pointer-events-none'>
                <img className='w-16' src="https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png" alt="" />
                <Link to='/captain/logout' title='Log out' className='pointer-events-auto mr-12 h-10 w-10 bg-white flex items-center justify-center rounded-full shadow'>
                    <i className="text-lg font-medium ri-logout-box-r-line"></i>
                </Link>
            </div>
            <div className='h-1/2 shrink-0'>
                <LiveTracking onLocate={sendLocation} markers={rideMarkers} />
            </div>
            <div className='flex-1 overflow-y-auto p-6'>
                <CaptainDetails stats={stats} online={online} onToggleOnline={toggleOnline} />
                {online && <NearbyRides rides={nearbyRides} onSelect={openRide} />}
            </div>
            <div ref={ridePopupPanelRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <RidePopUp
                    ride={ride}
                    setRidePopupPanel={setRidePopupPanel}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel}
                    confirmRide={confirmRide}
                />
            </div>
            <div ref={confirmRidePopupPanelRef} className='fixed w-full h-screen z-10 bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <ConfirmRidePopUp
                    ride={ride}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />
            </div>
        </div>
    )
}

export default CaptainHome
