import { useToast } from './Toast';

export function CopyableText({ text, display }: { text: string; display?: string }) {
  const { showToast } = useToast();

  const handleClick = () => {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard');
    });
  };

  return (
    <span
      onClick={handleClick}
      className="cursor-pointer hover:text-text-primary transition-colors"
      title="Click to copy"
    >
      {display ?? text}
    </span>
  );
}
