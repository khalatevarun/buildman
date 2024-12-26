import { WebContainer } from '@webcontainer/api';
import { useEffect, useState } from 'react';

interface PreviewProps {
  webContainer: WebContainer;
}

export function Preview({ webContainer }: PreviewProps) {
  // In a real implementation, this would compile and render the preview
  const [url, setUrl] = useState("");

  async function main() {
    const installProcess = await webContainer.spawn('npm', ['install']);

    installProcess.output.pipeTo(new WritableStream({
      write(data) {
        console.log(data);
      }
    }));

    await webContainer.spawn('npm', ['run', 'dev']);

    // Wait for `server-ready` event
    webContainer.on('server-ready', (port, url) => {
      // ...
      console.log("URL>>>", url)
      console.log("PORT>>>",port)
      setUrl(url);
    });
  }

  console.log("webcontainer", webContainer);

  useEffect(() => {
    main()
  }, [])
  return (
    <div className="w-full h-full border-">
      {!url && <div className="text-center">
        <p className="mb-2">Loading...</p>
      </div>}
      {url && <iframe width={"100%"} height={"100%"} src={url} />}
    </div>
  );
}