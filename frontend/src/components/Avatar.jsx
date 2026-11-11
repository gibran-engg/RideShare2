import React from 'react'

// A circle with the person's initials, used instead of a profile photo.
const Avatar = ({ firstname = '', lastname = '', size = 'h-12 w-12 text-lg' }) => {
    const initials = `${firstname?.[ 0 ] || ''}${lastname?.[ 0 ] || ''}`.toUpperCase() || '?'

    return (
        <div className={`${size} shrink-0 rounded-full bg-gray-800 text-white font-semibold flex items-center justify-center`}>
            {initials}
        </div>
    )
}

export default Avatar
