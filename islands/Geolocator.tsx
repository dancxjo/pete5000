import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface GeolocatorProps {
    onChange?: (location: string) => void;
}

export default function Geolocator(props: GeolocatorProps) {
    const location = useSignal("");
    useEffect(() => {
        navigator.geolocation.getCurrentPosition((position) => {
            const asString =
                `Latitude: ${position.coords.latitude}, Longitude: ${position.coords.longitude}`;
            if (!location.value && props.onChange) {
                props.onChange(asString);
            }
            location.value = asString;
        });
    }, []);

    useEffect(() => {
        if (props.onChange) {
            props.onChange(location.value);
        }
    }, [location.value]);
    return <div>{location.value}</div>;
}
