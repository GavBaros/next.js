import React from 'react'
import App from 'next/app'
import Head from 'next/head'
import { ApolloProvider } from '@apollo/react-hooks'

let globalApolloClient = null

/**
 * Creates a withApollo HOC
 * that provides the apolloContext
 * to a next.js Page or AppTree.
 */
export const createWithApollo = createApolloClient => ({
  ssr = true,
} = {}) => PageComponent => {
  if (typeof createApolloClient !== 'function') {
    throw new Error(
      '[withApollo] requires a function that returns an ApolloClient'
    )
  }
  const WithApollo = ({ apolloClient, apolloState, ...pageProps }) => {
    // Called by:
    // - getDataFromTree => apolloClient
    // - next.js ssr => apolloClient
    // - next.js csr => apolloState
    let client
    if (apolloClient) {
      client = apolloClient
    } else {
      client = initApolloClient(createApolloClient, apolloState, undefined)
    }
    return (
      <ApolloProvider client={client}>
        <PageComponent {...pageProps} />
      </ApolloProvider>
    )
  }

  // Set the correct displayName in development
  if (process.env.NODE_ENV !== 'production') {
    const displayName =
      PageComponent.displayName || PageComponent.name || 'Component'

    WithApollo.displayName = `withApollo(${displayName})`
  }

  if (ssr || PageComponent.getInitialProps) {
    WithApollo.getInitialProps = async ctx => {
      const { AppTree } = ctx
      const inAppContext = Boolean(ctx.ctx)

      if (process.env.NODE_ENV === 'development') {
        if (inAppContext) {
          console.warn(
            'Warning: You have opted-out of Automatic Static Optimization due to `withApollo` in `pages/_app`.\n' +
              'Read more: https://err.sh/next.js/opt-out-auto-static-optimization\n'
          )
        }
      }

      if (ctx.apolloClient) {
        throw new Error('Multiple instances of withApollo found.')
      }

      // Initialize ApolloClient
      const apolloClient = initApolloClient(
        createApolloClient,
        {},
        inAppContext ? ctx.ctx : ctx
      )

      // Add apolloClient to NextPageContext & NextAppContext
      // This allows us to consume the apolloClient inside our
      // custom `getInitialProps({ apolloClient })`.
      ctx.apolloClient = apolloClient
      if (inAppContext) {
        ctx.ctx.apolloClient = apolloClient
      }

      // Run wrapped getInitialProps methods
      let pageProps = {}
      if (PageComponent.getInitialProps) {
        pageProps = await PageComponent.getInitialProps(ctx)
      } else if (inAppContext) {
        pageProps = await App.getInitialProps(ctx)
      }

      // Only on the server:
      if (typeof window === 'undefined') {
        // When redirecting, the response is finished.
        // No point in continuing to render
        if (ctx.res && ctx.res.finished) {
          return pageProps
        }

        // Only if ssr is enabled
        if (ssr) {
          try {
            // Run all GraphQL queries
            const { getDataFromTree } = await import('@apollo/react-ssr')

            // Since AppComponents and PageComponents have different context types
            // we need to modify their props a little.
            let props
            if (inAppContext) {
              props = { ...pageProps, apolloClient }
            } else {
              props = { pageProps: { ...pageProps, apolloClient } }
            }

            // Takes React AppTree, determine which queries are needed to render,
            // then fetche them all.
            await getDataFromTree(<AppTree {...props} />)
          } catch (error) {
            // Prevent Apollo Client GraphQL errors from crashing SSR.
            // Handle them in components via the data.error prop:
            // https://www.apollographql.com/docs/react/api/react-apollo.html#graphql-query-data-error
            console.error('Error while running `getDataFromTree`', error)
          }

          // getDataFromTree does not call componentWillUnmount
          // head side effect therefore need to be cleared manually
          Head.rewind()
        }
      }

      // Extract query data from the Apollo store
      const apolloState = apolloClient.cache.extract()

      // To avoid calling initApollo() twice in the server we send the Apollo Client as a prop
      // to the component, otherwise the component would have to call initApollo() again but this
      // time without the context, once that happens the following code will make sure we send
      // the prop as `null` to the browser
      apolloClient.toJSON = () => null

      return {
        ...pageProps,
        apolloState,
        apolloClient,
      }
    }
  }

  return WithApollo
}

/**
 * Always creates a new apollo client on the server
 * Creates or reuses apollo client in the browser.
 * @param  {Object} initialState
 */
const initApolloClient = (createApolloClient, initialState, ctx) => {
  // Make sure to create a new client for every server-side request so that data
  // isn't shared between connections (which would be bad)
  if (typeof window === 'undefined') {
    return createApolloClient(initialState, ctx)
  }

  // Reuse client on the client-side
  if (!globalApolloClient) {
    globalApolloClient = createApolloClient(initialState, ctx)
  }

  return globalApolloClient
}
