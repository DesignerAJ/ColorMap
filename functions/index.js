// functions/index.js

const functions = require("firebase-functions");
const cors = require("cors")({origin: true});

require("dotenv").config();

/**
 * 맵박스 액세스 토큰을 반환하는 HTTP 호출 가능 함수
 * 리전을 'asia-northeast3' (서울)으로 지정
 */
exports.getMapboxToken = functions.https.onRequest(
    {region: "asia-northeast3"},
    (req, res) => {
      cors(req, res, () => {
        const mapboxToken = process.env.MAPBOX_TOKEN;

        if (mapboxToken) {
          res.status(200).send({token: mapboxToken});
        } else {
          res.status(500).send({error: "Mapbox token not configured."});
        }
      });
    });
