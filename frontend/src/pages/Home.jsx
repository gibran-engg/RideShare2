import React, { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import axios from 'axios';
import 'remixicon/fonts/remixicon.css'
import LocationSearchPanel from '../components/LocationSearchPanel';
import VehiclePanel from '../components/VehiclePanel';
import ConfirmRide from '../components/ConfirmRide';
import LookingForDriver from '../components/LookingForDriver';
import WaitingForDriver from '../components/WaitingForDriver';
import { SocketContext } from '../context/SocketContext';
import { useContext } from 'react';
import { UserDataContext } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import LiveTracking from '../components/LiveTracking';

const Home = () => {
    const [ pickup, setPickup ] = useState('')
    const [ destination, setDestination ] = useState('')
    const [ panelOpen, setPanelOpen ] = useState(false)
    const vehiclePanelRef = useRef(null)
    const confirmRidePanelRef = useRef(null)
    const vehicleFoundRef = useRef(null)
    const waitingForDriverRef = useRef(null)
    const panelRef = useRef(null)
    const panelCloseRef = useRef(null)
    const [ vehiclePanel, setVehiclePanel ] = useState(false)
    const [ confirmRidePanel, setConfirmRidePanel ] = useState(false)
    const [ vehicleFound, setVehicleFound ] = useState(false)
    const [ waitingForDriver, setWaitingForDriver ] = useState(false)
    const [ pickupSuggestions, setPickupSuggestions ] = useState([])
    const [ destinationSuggestions, setDestinationSuggestions ] = useState([])
    const [ activeField, setActiveField ] = useState(null)
    const [ fare, setFare ] = useState({})
    const [ vehicleType, setVehicleType ] = useState(null)
    const [ ride, setRide ] = useState(null)
    const [ userLocation, setUserLocation ] = useState(null)
    const [ nearbyCabs, setNearbyCabs ] = useState([])
    // True while the pickup field holds the address we filled in from the user's location.
    const pickupFromLocationRef = useRef(false)
    const lastLookupRef = useRef(null)

    const navigate = useNavigate()

    const { socket } = useContext(SocketContext)
    const { user } = useContext(UserDataContext)

    useEffect(() => {
        socket.emit("join", { userType: "user", userId: user._id })
    }, [ user ])

    useEffect(() => {
        const onRideConfirmed = ride => {
            setVehicleFound(false)
            setWaitingForDriver(true)
            setRide(ride)
        }
        const onRideStarted = ride => {
            setWaitingForDriver(false)
            navigate('/riding', { state: { ride } })
        }

        socket.on('ride-confirmed', onRideConfirmed)
        socket.on('ride-started', onRideStarted)

        return () => {
            socket.off('ride-confirmed', onRideConfirmed)
            socket.off('ride-started', onRideStarted)
        }
    }, [ socket ])

    // When the map finds the user, fill in the pickup with their address (unless they typed one).
    const handleLocate = async (location) => {
        setUserLocation(location)

        // Skip the lookup if the user hasn't moved much (about 50 m) since the last one.
        const last = lastLookupRef.current
        if (last && Math.abs(last.ltd - location.ltd) < 0.0005 && Math.abs(last.lng - location.lng) < 0.0005) return
        lastLookupRef.current = location

        if (pickup && !pickupFromLocationRef.current) return

        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-address`, {
                params: location,
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })
            setPickup(response.data.address)
            pickupFromLocationRef.current = true
        } catch {
            // Leave the pickup empty; the user can type it.
        }
    }

    // Show online cabs near the user, refreshed every 15 seconds.
    useEffect(() => {
        if (!userLocation) return

        const loadNearbyCabs = () => {
            axios.get(`${import.meta.env.VITE_BASE_URL}/maps/nearby-captains`, {
                params: userLocation,
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            }).then(response => setNearbyCabs(response.data)).catch(() => { })
        }

        loadNearbyCabs()
        const interval = setInterval(loadNearbyCabs, 15000)
        return () => clearInterval(interval)
    }, [ userLocation ])

    const cabMarkers = nearbyCabs.map(cab => ({
        id: cab._id,
        ltd: cab.location.ltd,
        lng: cab.location.lng,
        kind: 'cab',
        title: cab.vehicleType
    }))


    const choosePickup = (value) => {
        pickupFromLocationRef.current = false
        setPickup(value)
    }

    const handlePickupChange = async (e) => {
        choosePickup(e.target.value)
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                params: { input: e.target.value },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }

            })
            setPickupSuggestions(response.data)
        } catch {
            // handle error
        }
    }

    const handleDestinationChange = async (e) => {
        setDestination(e.target.value)
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                params: { input: e.target.value },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })
            setDestinationSuggestions(response.data)
        } catch {
            // handle error
        }
    }

    const submitHandler = (e) => {
        e.preventDefault()
    }

    useGSAP(function () {
        if (panelOpen) {
            gsap.to(panelRef.current, {
                height: '70%',
                padding: 24
                // opacity:1
            })
            gsap.to(panelCloseRef.current, {
                opacity: 1
            })
        } else {
            gsap.to(panelRef.current, {
                height: '0%',
                padding: 0
                // opacity:0
            })
            gsap.to(panelCloseRef.current, {
                opacity: 0
            })
        }
    }, [ panelOpen ])


    useGSAP(function () {
        if (vehiclePanel) {
            gsap.to(vehiclePanelRef.current, {
                y: 0, yPercent: 0
            })
        } else {
            gsap.to(vehiclePanelRef.current, {
                y: 0, yPercent: 100
            })
        }
    }, [ vehiclePanel ])

    useGSAP(function () {
        if (confirmRidePanel) {
            gsap.to(confirmRidePanelRef.current, {
                y: 0, yPercent: 0
            })
        } else {
            gsap.to(confirmRidePanelRef.current, {
                y: 0, yPercent: 100
            })
        }
    }, [ confirmRidePanel ])

    useGSAP(function () {
        if (vehicleFound) {
            gsap.to(vehicleFoundRef.current, {
                y: 0, yPercent: 0
            })
        } else {
            gsap.to(vehicleFoundRef.current, {
                y: 0, yPercent: 100
            })
        }
    }, [ vehicleFound ])

    useGSAP(function () {
        if (waitingForDriver) {
            gsap.to(waitingForDriverRef.current, {
                y: 0, yPercent: 0
            })
        } else {
            gsap.to(waitingForDriverRef.current, {
                y: 0, yPercent: 100
            })
        }
    }, [ waitingForDriver ])


    async function findTrip() {
        if (pickup.length < 3 || destination.length < 3) {
            alert('Enter a pick-up location and a destination first.')
            return
        }

        setFare({})
        setVehiclePanel(true)
        setPanelOpen(false)

        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/get-fare`, {
                params: { pickup, destination },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })
            setFare(response.data)
        } catch {
            setVehiclePanel(false)
            alert("Couldn't find a route between those places. Try picking them from the suggestions.")
        }
    }

    async function createRide() {
        const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/create`, {
            pickup,
            destination,
            vehicleType
        }, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        })


    }

    return (
        <div className='h-screen relative overflow-hidden'>
            <img className='w-16 absolute left-5 top-5 z-[1] pointer-events-none' src="https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png" alt="" />
            <div className='h-screen w-screen'>
                <LiveTracking onLocate={handleLocate} markers={cabMarkers} />
            </div>
            {/* The overlay lets clicks and drags through to the map; only the panels catch them. */}
            <div className=' flex flex-col justify-end h-screen absolute top-0 w-full z-[2] pointer-events-none'>
                <div className='p-6 bg-white relative pointer-events-auto rounded-t-2xl shadow-[0_-4px_12px_rgba(0,0,0,0.08)]'>
                    <h5 ref={panelCloseRef} onClick={() => {
                        setPanelOpen(false)
                    }} className='absolute opacity-0 right-6 top-6 text-2xl'>
                        <i className="ri-arrow-down-wide-line"></i>
                    </h5>
                    <div className='flex items-baseline justify-between pr-10'>
                        <h4 className='text-2xl font-semibold'>Find a trip</h4>
                        {userLocation && (
                            <p className='text-sm text-gray-600'>
                                {nearbyCabs.length === 0 ? 'No cabs online nearby' : `${nearbyCabs.length} cab${nearbyCabs.length > 1 ? 's' : ''} nearby`}
                            </p>
                        )}
                    </div>
                    <form className='relative py-3' onSubmit={(e) => {
                        submitHandler(e)
                    }}>
                        <div className="line absolute h-16 w-1 top-[50%] -translate-y-1/2 left-5 bg-gray-700 rounded-full"></div>
                        <input
                            onClick={() => {
                                setPanelOpen(true)
                                setActiveField('pickup')
                            }}
                            value={pickup}
                            onChange={handlePickupChange}
                            className='bg-[#eee] px-12 py-2 text-lg rounded-lg w-full'
                            type="text"
                            placeholder='Add a pick-up location'
                        />
                        <input
                            onClick={() => {
                                setPanelOpen(true)
                                setActiveField('destination')
                            }}
                            value={destination}
                            onChange={handleDestinationChange}
                            className='bg-[#eee] px-12 py-2 text-lg rounded-lg w-full  mt-3'
                            type="text"
                            placeholder='Enter your destination' />
                    </form>
                    <button
                        onClick={findTrip}
                        className='bg-black text-white px-4 py-2 rounded-lg mt-3 w-full'>
                        Find Trip
                    </button>
                </div>
                <div ref={panelRef} className='bg-white h-0 overflow-y-auto pointer-events-auto'>
                    <LocationSearchPanel
                        suggestions={activeField === 'pickup' ? pickupSuggestions : destinationSuggestions}
                        setPanelOpen={setPanelOpen}
                        setVehiclePanel={setVehiclePanel}
                        setPickup={choosePickup}
                        setDestination={setDestination}
                        activeField={activeField}
                    />
                </div>
            </div>
            <div ref={vehiclePanelRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <VehiclePanel
                    selectVehicle={setVehicleType}
                    fare={fare} setConfirmRidePanel={setConfirmRidePanel} setVehiclePanel={setVehiclePanel} />
            </div>
            <div ref={confirmRidePanelRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-6 pt-12'>
                <ConfirmRide
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}

                    setConfirmRidePanel={setConfirmRidePanel} setVehicleFound={setVehicleFound} />
            </div>
            <div ref={vehicleFoundRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-6 pt-12'>
                <LookingForDriver
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    setVehicleFound={setVehicleFound} />
            </div>
            <div ref={waitingForDriverRef} className='fixed w-full  z-10 bottom-0  bg-white px-3 py-6 pt-12'>
                <WaitingForDriver
                    ride={ride}
                    setVehicleFound={setVehicleFound}
                    setWaitingForDriver={setWaitingForDriver}
                    waitingForDriver={waitingForDriver} />
            </div>
        </div>
    )
}

export default Home