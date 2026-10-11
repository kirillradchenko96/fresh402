FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
COPY src/network-policy.mjs ./src/network-policy.mjs
COPY gateway/egress.mjs gateway/server.mjs gateway/network-self-test.mjs ./gateway/
USER node
ENV NODE_ENV=production
ENV GATEWAY_LISTEN_HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "--max-old-space-size=128", "gateway/server.mjs"]
