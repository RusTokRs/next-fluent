import { type MessageSource } from './catalog';
/**
 * FTL AST Key & Variable Extractor for TypeScript declaration generation.
 */
export interface ExtractedMessage {
    id: string;
    dotId: string;
    hasValue: boolean;
    attributes: string[];
    variables: string[];
    valueVariables: string[];
    attributeVariables: Record<string, string[]>;
}
export declare function extractMessagesFromFtl(ftlContent: MessageSource): ExtractedMessage[];
export declare function generateTypeDeclarations(ftlContents: MessageSource | readonly MessageSource[]): string;
