import React, { useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'

export const UserLogout = () => {

    const token = localStorage.getItem('token')
    const navigate = useNavigate()

    useEffect(() => {
        axios.get(`${import.meta.env.VITE_API_URL}/users/logout`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }).finally(() => {
            localStorage.removeItem('token')
            navigate('/login')
        })
    }, [])

    return (
        <div>Logging out...</div>
    )
}

export default UserLogout
