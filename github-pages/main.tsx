import { createRoot } from "react-dom/client";
import StudioApp from "../components/studio-app";
import CustomerOffer from "../components/customer-offer";
import ProofPage from "../app/proof/page";
import "../app/globals.css";

window.__MAKEROOM_STATIC__ = {
  basePath: "/makeroom/",
  apiOrigin: "https://makeroom-studio.abhinav-0905.chatgpt.site",
};
const query = new URLSearchParams(location.search);
const token = query.get("offer");
createRoot(document.getElementById("root")!).render(
  token ? <CustomerOffer token={token} /> :
    query.get("view") === "proof" ? <ProofPage /> : <StudioApp />,
);
