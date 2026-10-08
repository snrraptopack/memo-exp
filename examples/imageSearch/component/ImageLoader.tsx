import { type Photo } from "../types";

export default function ImageLoader({ photo }: { photo: Photo }) {
  let imgSrc = "";
  let imgRef: HTMLImageElement | null = null;


  $effect(() => {
    const loadImage = () => {
      const img = new Image();
      img.onload = () => {
       imgSrc = photo.src.large;
      };
      img.src = photo.src.large;
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          imgSrc = photo.src.small
          loadImage();
          observer.unobserve(entry.target);
        }
      });
    });


    if (imgRef) {
      observer.observe(imgRef);
    }

    return () => observer.disconnect();
  });

  return (
    <img
      ref={imgRef}
      className="loading-image"
      style={{
        aspectRatio: photo.width / photo.height,
      }}
      src={imgSrc}
      alt={photo.alt}
    />
  );
}
