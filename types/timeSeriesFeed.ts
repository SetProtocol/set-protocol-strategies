import { BigNumber } from "bignumber.js";

export interface LinkedList {
	dataSizeLimit: BigNumber;
	lastUpdatedIndex: BigNumber;
	dataArray: BigNumber[];  
}

export interface TimeSeriesFeedState {
  nextEarliestUpdate: BigNumber;
  updateInterval: BigNumber;
  timeSeriesData: LinkedList;
}