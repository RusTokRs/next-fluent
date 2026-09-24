/**
 * FTL AST Key & Variable Extractor for TypeScript declaration generation.
 */
export interface ExtractedMessage {
    id: string;
    dotId: string;
    attributes: string[];
    variables: string[];
    valueVariables: string[];
    attributeVariables: Record<string, string[]>;
}
export declare function extractMessagesFromFtl(ftlContent: string): ExtractedMessage[];
export declare function generateTypeDeclarations(ftlContents: string | readonly string[]): string;
