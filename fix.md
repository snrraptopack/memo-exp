plan

solidjs present some nicer architecture for data loading we have alot of stuff and also have the power to improve some stuff...

i planned that the $fetch now returns a resolved value example

const data = $fetch(',,,,');

data is a real value not something that contains like loading, error and stuff so i can pass it to a component

<Anything data={data}> and everything will work no null assetion but this also comes with a compiler integration the compiler should understandd $fetch and treat it as sync

assuming we want to see the states data i planned we introduce feature like $track now what $track will do it it will take data straight

example

const data = $fetch(....)
const dataState = $track(data); it just works though data is a value the compiler kows and dataState will return errors and stuff...
the track can take more object too

const data1 = $fetch(....)
const data2 = $fetch(....)
const dataState1 = $track(data1);
const dataState2 = $track(data2);

or

const dataState = $track({ data1, data2 }); where the errors or more info will be available via the
dataState.data1 and dataState.data2


going back to the normal data

const data = $fetch(....)

and pasing it to component <Data data={data}>

now sometimes we want to show loading state or error and stuff i have already shown the track way so the user can do something like


{dataState.isLoading && <isLoading>}
{dataState.error}.....
before they render something but we can go further i want to introduce the concept of group maybe we can rename it well we can have a compiler aware component example

<Group data={data}>
    <Pending component={} />
    <Error component={} />
    <OurComponent props={} />
</Group> i know this is bad but we can design it ewell

the person has to just pass the raw data value to the group and the state will be handled automatically

now we are trying to execute async as sync so the component renders immmediately and inside those component it only the places that needs the data actuall see the pending stuff...


```tsx
function MyComponent({ data }) {
    return (
        <div>
            <h1>nothing yet</h1>
            <div>{data}</div>
            <div>again</div>
        </div>
    );
}


//assuming we import this component somwehere


function App() {
    const data = $fetch();
    return (
        <div>
          <hq>nothing</hq>
          <Group data={data}>
              <Pending component={} />
              <Error component={} />
              <MyComponent data={data} />
          </Group>
        </div>
    );
}

```

the pending will show exactly at the <div>{data}</div> so the rest of the content of will be showed so imagine we data was an object or something that we accessed in different places in that compoent then the loading will show at those distcict places each..


what if a component have more than one fetch value

```tsx
function MyComponent({ data1, data2 }) {
    return (
        <div>
            <h1>nothing yet</h1>
            <div>{data1}</div>
            <div>{data2}</div>
        </div>
    );
}


function App() {
    const data1 = $fetch();
    const data2 = $fetch();

    return (
        <div>
          <hq>nothing</hq>
          <Group data={{ data1, data2 }}>
              <Pending component={} />
              <Error component={} />
              <MyComponent data1={data1} data2={data2} />
          </Group>
        </div>
    );
}
```

now the loading and stuff will show at their distinct places and if say data2 finished before 1 data two will show and still data one will be showing the pending state
