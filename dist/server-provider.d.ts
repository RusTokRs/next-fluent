import React from 'react';
export interface FluentServerProviderProps {
    children: React.ReactNode;
    locale?: string;
}
/** Loads one request snapshot and forwards its serializable values to the client boundary. */
export declare function FluentServerProvider({ children, locale }: FluentServerProviderProps): Promise<React.FunctionComponentElement<import("./client.js").FluentProviderProps>>;
