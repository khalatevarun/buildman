import { useEffect, useState } from "react";
import { WebContainer } from '@webcontainer/api';

export function useWebContainer() {
    const [webcontainer, setWebcontainer] = useState<WebContainer | null>(null);

    async function main() {
        try {
            console.log("Initializing WebContainer...");
            const webcontainerInstance = await WebContainer.boot();
            console.log("WebContainer instance:", webcontainerInstance);
            setWebcontainer(webcontainerInstance);
        } catch (error) {
            console.error("Failed to initialize WebContainer:", error);
        }
    }

    useEffect(() => {
        if (!webcontainer) {
            main();
        }
    }, []);

    return webcontainer;
}