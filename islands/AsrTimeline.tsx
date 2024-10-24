import { JSX } from "preact";
import type { TranscribedSegment } from "../lib/whisper.ts";
import { useEffect, useRef } from "preact/hooks";
import { Head } from "$fresh/runtime.ts";
import { type Timeline, type TimelineItem } from "npm:vis-timeline";

declare const vis: typeof import("npm:vis-timeline");
interface TimelineProps extends JSX.HTMLAttributes<HTMLDivElement> {
    items: TimelineItem[];
}

export function ASRTimeline(props: TimelineProps) {
    const { items, ...rest } = props;
    const timelineRef = useRef<HTMLDivElement>(null);
    const timelineInstance = useRef<Timeline>(null);

    useEffect(() => {
        if (timelineRef.current) {
            const options = {
                stack: true,
                editable: false,
                margin: {
                    item: 10,
                },
            };

            if (timelineInstance.current) {
                timelineInstance.current.setItems(items);
                timelineInstance.current.setOptions(options);
                // timelineInstance.current.fit();
            } else {
                timelineInstance.current = new vis.Timeline(
                    timelineRef.current,
                    items,
                    options,
                );
            }
        }
    }, [items]);

    return (
        <>
            <Head>
                <script
                    src="https://cdnjs.cloudflare.com/ajax/libs/vis/4.21.0/vis.min.js"
                    integrity="sha512-XHDcSyqhOoO2ocB7sKOCJEkUjw/pQCJViP1ynpy+EGh/LggzrP6U/V3a++LQTnZT7sCQKeHRyWHfhN2afjXjCg=="
                    crossorigin="anonymous"
                    referrerpolicy="no-referrer"
                >
                </script>
                <link
                    rel="stylesheet"
                    href="https://cdnjs.cloudflare.com/ajax/libs/vis/4.21.0/vis-timeline-graph2d.min.css"
                    integrity="sha512-bbXw0l+sIgE839ldwV4+tEPR4lIelw+Ryj35jm5c6KTgXNJybZJ4DrV+a40zK9kx8pvqNbneG0TGdJBP2jUa4Q=="
                    crossorigin="anonymous"
                    referrerpolicy="no-referrer"
                />
                <script
                    src="https://cdnjs.cloudflare.com/ajax/libs/vis/4.21.0/vis-timeline-graph2d.min.js"
                    integrity="sha512-e7wHjGSu73zD0szO6qaOwIlpco3utvaPyHzjRVsgU34Hw+yzlPXcSC27jlL3ddg0csFbdrx67QWS8pyVVMX10w=="
                    crossorigin="anonymous"
                    referrerpolicy="no-referrer"
                >
                </script>
            </Head>
            <div {...rest} ref={timelineRef} class="timeline-container"></div>
        </>
    );
}
