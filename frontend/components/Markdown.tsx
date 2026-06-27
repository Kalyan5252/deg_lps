"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

/**
 * Rich, readable Markdown renderer for mentor messages — GitHub-flavored
 * markdown (tables, task lists, etc.) with syntax-highlighted code blocks.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body prose prose-sm max-w-none prose-pre:my-2 prose-pre:bg-canvas prose-pre:text-ink prose-code:text-ink prose-headings:mt-3 prose-headings:mb-1.5 prose-p:my-1.5 prose-li:my-0.5 prose-ul:my-1.5 prose-ol:my-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
