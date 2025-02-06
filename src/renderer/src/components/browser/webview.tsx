import { activeTabRefAtom, Tab, tabsAtom } from "@renderer/atoms/browser";
import { cn } from "@renderer/lib/utils";
import { useAtom } from "jotai";
import uuid4 from "uuid4";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { extractReadableContent } from "@renderer/lib/readability";

export function WebView({ tab }: { tab: Tab }) {
  const [tabs, setTabs] = useAtom(tabsAtom);
  const [activeTabRef, setActiveTabRef] = useAtom(activeTabRefAtom);
  const ref = useRef<HTMLWebViewElement>(null);
  const [isWebViewReady, setIsWebViewReady] = useState(false);
  const [webviewTargetUrl, setWebviewTargetUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [readerContent, setReaderContent] = useState("");

  const ipcHandle = (ref: any): void => {
    if (ref.current && isWebViewReady) {
      window.api.getActiveTab(ref.current.getWebContentsId());
    }
  };

  // Reusable function to update the current tab's properties
  const updateCurrentTab = (updater: (tab: Tab) => Tab) => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => (t.id === tab.id ? updater(t) : t))
    );
  };

  useEffect(() => {
    // Set the current tab's ref
    updateCurrentTab((t) => ({ ...t, ref }));
  }, [setTabs]);

  useEffect(() => {
    if (tab.readerMode && ref.current && isWebViewReady) {
      console.log("Extracting readable content");
      extractReadableContent(ref.current).then(async (content) => {
        console.log("Content extracted:", content);

        setReaderContent(content);
      });
    }
  }, [tab.readerMode, isWebViewReady]);

  useEffect(() => {
    const webview = ref.current;
    if (!webview) return;

    const handleDomReady = () => {
      setIsWebViewReady(true); // Mark webview as ready
      if (tab.isActive) {
        ipcHandle(ref); // Call ipcHandle if the tab is active
      }
      handleTitleUpdate();
    };

    const handleTitleUpdate = () => {
      updateCurrentTab((t) => ({ ...t, title: webview.getTitle() }));
      console.log("Title updated:", webview.getTitle());
    };

    const handleFaviconUpdate = (event: any) => {
      updateCurrentTab((t) => ({ ...t, favicon: event.favicons[0] }));
      console.log("Favicon updated:", event.favicons[0]);
    };

    const handleTargetUrlUpdate = (event: any) => {
      setWebviewTargetUrl(event.url);
      console.log("Target URL updated:", event.url);
    };

    const handleFullNavigation = (event: any) => {
      if (event.isMainFrame) {
        console.log("Navigated to:", event.url);
        updateCurrentTab((t) => ({ ...t, url: event.url }));
      }
    };

    const handleInPageNavigation = (event: any) => {
      if (event.isMainFrame) {
        console.log("In-page navigation to:", event.url);
      }
    };

    const handleStartLoading = () => {
      setIsLoading(true);
    };

    const handleStopLoading = () => {
      setIsLoading(false);
    };

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("page-title-updated", handleTitleUpdate);
    webview.addEventListener("page-favicon-updated", handleFaviconUpdate);
    webview.addEventListener("update-target-url", handleTargetUrlUpdate);
    webview.addEventListener("did-navigate", handleFullNavigation);
    webview.addEventListener("did-navigate-in-page", handleInPageNavigation);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-finish-load", handleStopLoading);
    webview.addEventListener("did-fail-load", handleStopLoading);

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("page-title-updated", handleTitleUpdate);
      webview.removeEventListener("page-favicon-updated", handleFaviconUpdate);
      webview.removeEventListener("update-target-url", handleTargetUrlUpdate);
      webview.removeEventListener("did-navigate", handleFullNavigation);
      webview.removeEventListener("did-navigate-in-page", handleInPageNavigation);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-finish-load", handleStopLoading);
      webview.removeEventListener("did-fail-load", handleStopLoading);
    };
  }, [ref, tab.isActive]);

  useEffect(() => {
    if (tab.isActive && isWebViewReady) {
      ipcHandle(ref);
    }
  }, [tab.isActive, activeTabRef, isWebViewReady]);

  return (
    <div className={cn("w-full h-full bg-white", !tab.isActive && "hidden")}>
      <AnimatePresence>
        {isLoading && (
          <motion.div
            className="fixed top-0 left-0 right-0 h-1 bg-blue-500 z-50"
            initial={{ width: 0 }}
            animate={{ width: "90%" }}
            exit={{
              width: "100%",
              opacity: 0,
              transition: {
                width: { duration: 0.3 },
                opacity: { duration: 0.3, delay: 0.2 },
              },
            }}
            transition={{
              duration: 4,
              ease: "linear",
            }}
          />
        )}
      </AnimatePresence>

      {/* The standard webview */}
      <webview
        ref={ref}
        key={tab.id}
        src={tab.url}
        id={tab.id}
        className={cn("w-full h-full", tab.readerMode && "hidden")}
        webpreferences="autoplayPolicy=document-user-activation-required,defaultFontSize=16,contextIsolation=true,nodeIntegration=false,sandbox=true,webSecurity=true,nativeWindowOpen=true"
        allowpopups="true"
        partition="persist:webview"
        style={{ pointerEvents: "unset" }}
      />

      {/* Reader mode view */}
      {tab.readerMode && (
        <div className="w-full h-full flex justify-center items-center bg-background">
          <div className="max-w-4xl w-full h-full overflow-y-auto p-8 prose prose-lg mx-auto dark:prose-invert">
            <div dangerouslySetInnerHTML={{ __html: readerContent }} />
          </div>
        </div>
      )}

      <AnimatePresence>
        {webviewTargetUrl && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="text-xs m-1 h-fit w-fit max-w-[500px] z-50 p-1 px-2 truncate bg-popover border-border border fixed bottom-4 right-4 rounded-lg pointer-events-none"
            layout
          >
            {webviewTargetUrl}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function reloadTab(activeTabRef: any) {
  if (activeTabRef.current) {
    activeTabRef.current?.reload();
  }
}

export function goBackTab(activeTabRef: any) {
  if (activeTabRef.current) {
    activeTabRef.current?.goBack();
  }
}

export function goForwardTab(activeTabRef: any) {
  if (activeTabRef.current) {
    activeTabRef.current?.goForward();
  }
}

export function newTab(url: string, title: string, setTabs: any) {
  const newTab = {
    id: uuid4(),
    title: title,
    url: url,
    favicon: "",
    isActive: true,
  };

  setTabs((prevTabs: any[]) => {
    const updatedTabs = prevTabs.map((tab) => ({
      ...tab,
      isActive: false,
    }));
    return [...updatedTabs, newTab];
  });
}

export function closeTab(
  tabId: string,
  tabs: Tab[],
  setTabs: (updater: (prevTabs: Tab[]) => Tab[]) => void
) {
  console.log("Closing tab with ID:", tabId);

  const tabToClose = tabs.find((tab) => tab.id === tabId);
  if (!tabToClose) {
    console.error("Tab not found");
    return;
  }

  const webview = tabToClose.ref.current;
  if (!webview) {
    console.error("Webview not found");
    return;
  }

  const webContentsId = webview.getWebContentsId();
  console.log("Closing tab", webContentsId);
  window.api.closeTab(webContentsId);

  setTabs((prevTabs) => {
    console.log("Closing tab with ID:", tabId);
    console.log("Current tabs:", prevTabs);
    const updatedTabs = prevTabs.filter((tab) => tab.id !== tabId);
    console.log("Updated tabs after closing:", updatedTabs);

    if (updatedTabs.length === 0) {
      return [];
    }

    const wasActiveTabClosed = prevTabs.find((tab) => tab.id === tabId)?.isActive;
    if (wasActiveTabClosed) {
      updatedTabs[0].isActive = true;
    }
    return updatedTabs;
  });
}

export const handleToggleDevTools = (activeTabRef: any) => {
  if (activeTabRef.current) {
    if (activeTabRef.current.isDevToolsOpened()) {
      activeTabRef.current.closeDevTools();
    } else {
      activeTabRef.current.openDevTools();
    }
  }
};

// Updated toggleReadingMode that correctly updates state.
export const toggleReadingMode = (
  tab: Tab,
  setTabs: (updater: (prevTabs: Tab[]) => Tab[]) => Tab[]
) => {
  setTabs((prevTabs) =>
    prevTabs.map((t) =>
      t.id === tab.id ? { ...t, readerMode: !t.readerMode } : t
    )
  );
  console.log("Toggled reading mode for:", tab.title);
};

