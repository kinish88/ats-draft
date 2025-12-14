interface TinyLogoProps {
  url: string | null | undefined;
  alt: string;
  className?: string;
}

export default function TinyLogo({ url, alt, className }: TinyLogoProps) {
  if (!url) {
    return <span className={`inline-block align-middle ${className || 'w-4 h-4 mr-2'}`} />;
  }

  return (
    <img
      alt={alt}
      src={url}
      className={`inline-block rounded-sm align-middle ${className || 'w-4 h-4 mr-2'}`}
      loading="eager"
    />
  );
}
