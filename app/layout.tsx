import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={
 title:"MakeRoom | A little flexibility. One more booking.",
 description:"Create a longer studio booking with customer-approved moves and PayPal refunds.",
 icons:{icon:"/favicon.svg"},
 metadataBase:new URL("https://makeroom-studio.abhinav-0905.chatgpt.site"),
 robots:{index:false,follow:false}
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}

