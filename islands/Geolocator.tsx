import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

export default function Geolocator() {
    const location = useSignal("Determining location...");
    useEffect(() => {
        navigator.geolocation.getCurrentPosition((position) =>
            location.value =
                `Latitude: ${position.coords.latitude}, Longitude: ${position.coords.longitude}`
        );
    }, []);
    return <div>{location.value}</div>;
}
