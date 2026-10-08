import {type  ImageSearchResponse } from "./types";
import ImageLoader from "./component/ImageLoader";
const authorization = 'sKbofvHmytF7iE3m5AkZvT1bNipNvArTnuit6ztm5nfUfDUxKysKNN5u';

const App = () => {

  const forms = $forms((field) => {
    const searchTerm = field.get("searchTerm") as string;
    const images = $fetch<ImageSearchResponse>(`https://api.pexels.com/v1/search`, {
      query: {
        per_page: 30,
        query: searchTerm,
      },
      headers: {
        authorization,
      },
    })

    return images
  })



  return (
    <>
      <h1>Auwla Image Search</h1>
      <form onSubmit={forms.submit}>
        <label htmlFor="searchTerm">Search Term</label>
        <input
          className="u-full-width"
          type="text"
          id="searchTerm"
          name="searchTerm"
        />
        <button type="submit">Search</button>
      </form>
      {forms.pending && (
        <img
          alt="loading"
          id="loadingImage"
          src="https://i.imgur.com/LVHmLnb.gif"
        />
      )}
      <section className="images">
        {forms.result?.photos.map((photo) => (
          <ImageLoader key={photo.id} photo={photo} />
        ))}
      </section>
      {forms.errors && forms.errors.map((error) => (
        <div key={error.message}>{error.message}</div>
      ))}
    </>
  );
};

export default App;
