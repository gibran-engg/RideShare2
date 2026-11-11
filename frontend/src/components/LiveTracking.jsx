import React, { useEffect, useRef, useState } from 'react'
import { OlaMaps } from 'olamaps-web-sdk'

// Ola Maps covers India, so start over Mumbai until the browser reports a location.
const defaultCenter = {
    lat: 19.076,
    lng: 72.8777
};

const markerIcons = {
    cab: 'ri-taxi-fill',
    pickup: 'ri-map-pin-user-fill'
};

function createMarkerElement(kind, title) {
    const element = document.createElement('div');
    element.className = 'h-8 w-8 rounded-full bg-black text-white flex items-center justify-center shadow-lg border-2 border-white';
    element.title = title || '';
    element.innerHTML = `<i class="${markerIcons[ kind ] || markerIcons.cab}"></i>`;
    return element;
}

/**
 * Map with a locate-me button that marks and follows the user's position.
 * - onLocate({ ltd, lng }) is called whenever the browser reports a new position.
 * - markers: [{ id, ltd, lng, kind: 'cab' | 'pickup', title }] are drawn on top.
 */
const LiveTracking = ({ onLocate, markers = [] }) => {
    const containerRef = useRef(null);
    const olaMapsRef = useRef(null);
    const mapRef = useRef(null);
    const drawnMarkersRef = useRef({});
    const onLocateRef = useRef(onLocate);
    const [ mapReady, setMapReady ] = useState(false);

    onLocateRef.current = onLocate;

    useEffect(() => {
        let map;
        let cancelled = false;

        const olaMaps = new OlaMaps({ apiKey: import.meta.env.VITE_OLA_MAPS_API_KEY });
        olaMapsRef.current = olaMaps;

        olaMaps.init({
            style: 'https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json',
            container: containerRef.current,
            center: [ defaultCenter.lng, defaultCenter.lat ], // Ola Maps uses [lng, lat]
            zoom: 15
        }).then((olaMap) => {
            if (cancelled) {
                olaMap.remove();
                return;
            }
            map = olaMap;
            mapRef.current = map;

            // Make sure the map redraws once street data arrives.
            map.on('sourcedata', () => map.triggerRepaint());
            // Ola's default style lists a 3D layer whose data isn't served; skip that known error.
            map.on('error', (event) => {
                const message = event.error?.message || String(event);
                if (!message.includes('3d_model')) console.error('Ola Maps:', message);
            });
            map.triggerRepaint();

            // The locate-me button: shows a blue dot for the user and follows them until they drag the map.
            const geolocate = olaMaps.addGeolocateControls({
                positionOptions: { enableHighAccuracy: true },
                trackUserLocation: true
            });
            map.addControl(geolocate, 'top-right');
            geolocate.on('geolocate', (position) => {
                onLocateRef.current?.({ ltd: position.coords.latitude, lng: position.coords.longitude });
            });

            // Locate the user straight away, once the button is ready.
            const locate = (attempt = 0) => {
                if (cancelled) return;
                if (geolocate.trigger() === false && attempt < 10) {
                    setTimeout(() => locate(attempt + 1), 300);
                }
            };
            locate();

            setMapReady(true);
        });

        return () => {
            cancelled = true;
            Object.values(drawnMarkersRef.current).forEach(marker => marker.remove());
            drawnMarkersRef.current = {};
            map?.remove();
        };
    }, []);

    // Keep the extra markers in sync with the `markers` prop.
    useEffect(() => {
        if (!mapReady) return;

        const drawn = drawnMarkersRef.current;
        const wanted = new Set(markers.map(marker => String(marker.id)));

        Object.keys(drawn).forEach(id => {
            if (!wanted.has(id)) {
                drawn[ id ].remove();
                delete drawn[ id ];
            }
        });

        markers.forEach(({ id, ltd, lng, kind, title }) => {
            if (ltd == null || lng == null) return;
            const key = String(id);
            if (drawn[ key ]) {
                drawn[ key ].setLngLat([ lng, ltd ]);
            } else {
                drawn[ key ] = olaMapsRef.current.addMarker({ element: createMarkerElement(kind, title) })
                    .setLngLat([ lng, ltd ])
                    .addTo(mapRef.current);
            }
        });
    }, [ markers, mapReady ]);

    return <div ref={containerRef} className='h-full w-full' />
}

export default LiveTracking
